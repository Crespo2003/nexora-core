import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { extractTenancyFile } from '../../../../lib/ai/tenancyExtractor';
import { validateFileSignature, workspaceStoragePath } from '../../../../lib/documents/upload';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const maxUploadBytes = 10 * 1024 * 1024;
const storageBucket = 'real-estate-documents';

export const maxDuration = 300;

function sanitizeStorageFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? 'document';
  const base = filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base || 'tenancy-agreement'}-${crypto.randomUUID()}.${extension}`;
}

export async function POST(request: Request) {
  let uploadedPath: string | null = null;
  let supabase: any;

  try {
    const requestSizeError = rejectOversizedRequest(request, maxUploadBytes + 1024 * 1024);
    if (requestSizeError) return requestSizeError;
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    ({ supabase } = auth);
    const { workspaceId } = auth;

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded.', stage: 'upload' }, { status: 400 });
    }

    if (file.size > maxUploadBytes) {
      return NextResponse.json({ error: 'File is too large.', stage: 'upload' }, { status: 400 });
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isDocx =
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.name.toLowerCase().endsWith('.docx');
    const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');

    if (!isPdf && !isDocx && !isTxt) {
      return NextResponse.json({ error: 'Unsupported file type.', stage: 'upload' }, { status: 400 });
    }

    const storagePath = workspaceStoragePath(workspaceId, 'tenancy-agreements', sanitizeStorageFilename(file.name));
    const buffer = Buffer.from(await file.arrayBuffer());
    const documentHash = createHash('sha256').update(buffer).digest('hex');
    const mimeType = isPdf
      ? 'application/pdf'
      : isDocx
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'text/plain';
    if (!validateFileSignature(buffer, mimeType)) {
      return NextResponse.json({ error: 'File content does not match its type.', stage: 'upload' }, { status: 400 });
    }
    const duplicate = await supabase.from('documents').select('id, processing_status')
      .eq('workspace_id', workspaceId).eq('document_hash', documentHash).maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) {
      return NextResponse.json({
        error: 'duplicate-document', stage: 'duplicate-check', documentId: duplicate.data.id,
        retryAllowed: ['ocr_required', 'extraction_failed'].includes(String(duplicate.data.processing_status))
      }, { status: 409 });
    }

    const upload = await supabase.storage.from(storageBucket).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false
    });

    if (upload.error) throw upload.error;
    uploadedPath = storagePath;

    let extraction: Awaited<ReturnType<typeof extractTenancyFile>>;
    try {
      extraction = await extractTenancyFile({ buffer, filename: file.name, mimeType });
    } catch (error) {
      const technicalReference = getApiErrorMessage(error);
      const sanitizedFilename = storagePath.split('/').pop() ?? file.name;
      const bundle = await supabase.rpc('sprint_005_create_document_bundle', {
        p_workspace_id: workspaceId,
        p_payload: {
          tenancyId: null,
          originalFilename: file.name,
          sanitizedFilename,
          storageBucket,
          storagePath,
          mimeType,
          fileSize: file.size,
          documentType: 'tenancy_agreement',
          processingStatus: 'extraction_failed',
          documentHash,
          processingAttempts: 1,
          processingError: technicalReference,
          rawText: '',
          extractedJson: {},
          confidenceJson: {},
          aiSummary: 'Document preserved after extraction failure. Retry processing from Document Centre.',
          lowConfidenceFields: []
        }
      });
      if (bundle.error) throw bundle.error;
      uploadedPath = null;
      const saved = bundle.data as { document: { id: string }; extraction: { id: string } };
      return NextResponse.json({
        error: 'document-extraction-failed', stage: 'extraction', documentId: saved.document.id,
        extractionId: saved.extraction.id, retryAllowed: true, rollbackStatus: 'document-preserved',
        message: {
          en: 'The document was saved, but extraction failed. Retry it from Document Centre.',
          zh: '文件已保存，但提取失败。请从文件中心重试。'
        },
        technicalReference
      }, { status: 422 });
    }

    return NextResponse.json({
      extraction,
      document: {
        originalFilename: file.name,
        storagePath,
        mimeType,
        fileSize: file.size,
        documentType: extraction.document.documentType,
        uploadStatus: 'uploaded',
        documentHash
      }
    });
  } catch (error) {
    console.error('Tenancy document upload/parse failed');

    if (uploadedPath) {
      try {
        await supabase?.storage.from(storageBucket).remove([uploadedPath]);
      } catch (cleanupError) {
        console.error('Tenancy document upload cleanup failed');
      }
    }

    return NextResponse.json({ error: getApiErrorMessage(error), stage: 'upload' }, { status: 500 });
  }
}
