import { NextResponse } from 'next/server';
import { classifyDocument } from '../../../../lib/ai/documentClassifier';
import { extractTenancyDetails } from '../../../../lib/ai/tenancyExtractor';
import { detectScannedDocument } from '../../../../lib/documents/detectScannedDocument';
import { parseDocx } from '../../../../lib/documents/parseDocx';
import { parsePdf } from '../../../../lib/documents/parsePdf';
import { inferMimeTypeFromName, validateFileSignature, workspaceStoragePath } from '../../../../lib/documents/upload';
import { allowedDocumentMimeTypes, maxDocumentUploadBytes } from '../../../../lib/documents/types';
import { FallbackOcrProvider } from '../../../../lib/ocr/fallbackOcr';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const storageBucket = 'real-estate-documents';

async function extractText(buffer: Buffer, filename: string, mimeType: string) {
  if (mimeType === 'application/pdf') return parsePdf(buffer);
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return parseDocx(buffer);
  const ocr = new FallbackOcrProvider();
  const result = await ocr.extractText({ buffer, filename, mimeType });
  return result.text;
}

export async function POST(request: Request) {
  let storagePath: string | null = null;
  let supabase: any;

  try {
    const requestSizeError = rejectOversizedRequest(request, maxDocumentUploadBytes + 1024 * 1024);
    if (requestSizeError) return requestSizeError;
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    ({ supabase } = auth);
    const { workspaceId } = auth;

    const formData = await request.formData();
    const file = formData.get('file');
    const selectedDocumentType = String(formData.get('documentType') ?? '');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'no-file', stage: 'upload' }, { status: 400 });
    }

    const mimeType = file.type || inferMimeTypeFromName(file.name);

    if (!allowedDocumentMimeTypes.includes(mimeType)) {
      return NextResponse.json({ error: 'unsupported-file-type', stage: 'upload' }, { status: 400 });
    }

    if (file.size > maxDocumentUploadBytes) {
      return NextResponse.json({ error: 'file-too-large', stage: 'upload' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!validateFileSignature(buffer, mimeType)) {
      return NextResponse.json({ error: 'file-content-mismatch', stage: 'upload' }, { status: 400 });
    }
    storagePath = workspaceStoragePath(workspaceId, selectedDocumentType || 'document-centre', file.name);
    const sanitizedFilename = storagePath.split('/').pop() ?? file.name;

    const upload = await supabase.storage.from(storageBucket).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false
    });

    if (upload.error) throw upload.error;

    const rawText = await extractText(buffer, file.name, mimeType);
    const scanned = detectScannedDocument(rawText, mimeType);
    const classification = classifyDocument(rawText, file.name, mimeType);
    const documentType = selectedDocumentType || classification.documentType;
    const tenancyExtraction = documentType === 'tenancy_agreement' && rawText
      ? extractTenancyDetails(rawText, file.name, mimeType)
      : null;
    const extractionStatus = scanned.ocrRequired ? 'ocr_required' : rawText ? 'extraction_completed' : 'extraction_failed';

    const documentInsert = await supabase
      .from('documents')
      .insert({
        original_filename: file.name,
        workspace_id: workspaceId,
        sanitized_filename: sanitizedFilename,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        mime_type: mimeType,
        file_size: file.size,
        document_type: documentType,
        upload_status: 'uploaded',
        processing_status: extractionStatus === 'extraction_completed' ? 'pending_review' : extractionStatus,
        linked_status: 'unlinked'
      })
      .select('*')
      .single();

    if (documentInsert.error) throw documentInsert.error;

    const extractionInsert = await supabase
      .from('document_extractions')
      .insert({
        document_id: documentInsert.data.id,
        workspace_id: workspaceId,
        extraction_version: 'fallback-v1',
        raw_text: rawText,
        extracted_json: tenancyExtraction ?? {},
        confidence_json: tenancyExtraction ?? { classification },
        ai_summary: tenancyExtraction?.summary ?? (scanned.ocrRequired ? 'OCR required; no readable text extracted.' : 'Document extracted with fallback parser.'),
        extraction_status: extractionStatus,
        extraction_error: scanned.ocrRequired ? scanned.reason : null,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      })
      .select('*')
      .single();

    if (extractionInsert.error) throw extractionInsert.error;

    await supabase.from('document_activity').insert({
      document_id: documentInsert.data.id,
      workspace_id: workspaceId,
      activity_type: extractionStatus === 'extraction_completed' ? 'extraction_completed' : 'extraction_failed',
      activity_json: { filename: file.name, extractionStatus }
    });

    return NextResponse.json({
      document: documentInsert.data,
      extraction: extractionInsert.data,
      classification,
      ocrRequired: scanned.ocrRequired
    });
  } catch (error) {
    console.error('Document Centre upload failed');

    if (storagePath) {
      try {
        await supabase?.storage.from(storageBucket).remove([storagePath]);
      } catch (cleanupError) {
        console.error('Document Centre upload cleanup failed');
      }
    }

    return NextResponse.json({ error: getApiErrorMessage(error), stage: 'upload' }, { status: 500 });
  }
}
