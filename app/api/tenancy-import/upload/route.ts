import { NextResponse } from 'next/server';
import { extractTenancyDetails } from '../../../../lib/ai/tenancyExtractor';
import { parseDocx } from '../../../../lib/documents/parseDocx';
import { parsePdf } from '../../../../lib/documents/parsePdf';
import { validateFileSignature, workspaceStoragePath } from '../../../../lib/documents/upload';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const maxUploadBytes = 10 * 1024 * 1024;
const storageBucket = 'real-estate-documents';

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

    if (!isPdf && !isDocx) {
      return NextResponse.json({ error: 'Unsupported file type.', stage: 'upload' }, { status: 400 });
    }

    const storagePath = workspaceStoragePath(workspaceId, 'tenancy-agreements', sanitizeStorageFilename(file.name));
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!validateFileSignature(buffer, mimeType)) {
      return NextResponse.json({ error: 'File content does not match its type.', stage: 'upload' }, { status: 400 });
    }

    const upload = await supabase.storage.from(storageBucket).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false
    });

    if (upload.error) throw upload.error;
    uploadedPath = storagePath;

    const text = isPdf ? await parsePdf(buffer) : await parseDocx(buffer);
    const extraction = extractTenancyDetails(
      text,
      file.name,
      file.type || (isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    );

    return NextResponse.json({
      extraction,
      document: {
        originalFilename: file.name,
        storagePath,
        mimeType,
        fileSize: file.size,
        documentType: extraction.document.documentType,
        uploadStatus: 'uploaded'
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
