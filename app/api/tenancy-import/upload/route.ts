import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { extractTenancyFile } from '../../../../lib/ai/tenancyExtractor';
import { validateFileSignature, workspaceStoragePath } from '../../../../lib/documents/upload';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';
import { getOpenAiConfiguration } from '../../../../lib/ai/openAiConfig';
import { logExtractionDiagnostic, logExtractionFailure } from '../../../../lib/ai/extractionDiagnostics';
import { TenancyExtractionError } from '../../../../lib/ai/extractTenancy';

const maxUploadBytes = 10 * 1024 * 1024;
const storageBucket = 'real-estate-documents';

export const maxDuration = 300;

type ErrorExtras = Record<string, unknown>;

function uploadError(error: string, stage: string, status: number, extras: ErrorExtras = {}) {
  return NextResponse.json({ success: false, error, stage, ...extras }, { status });
}

async function asNextJsonResponse(response: Response) {
  try {
    const payload: unknown = await response.clone().json();
    return NextResponse.json(
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : { success: false, error: 'request-rejected' },
      { status: response.status }
    );
  } catch {
    return uploadError('request-rejected', 'authorization', response.status || 500);
  }
}

function safeErrorDetails(error: unknown) {
  const details = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown; requestId?: unknown } : {};
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown-error';
  return {
    code: typeof details.code === 'string' ? details.code : undefined,
    status: typeof details.status === 'number' ? details.status : undefined,
    requestId: typeof details.requestId === 'string' ? details.requestId : undefined,
    message: message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500)
  };
}

function extractionFailureDetails(error: unknown): {
  stage: 'pdf' | 'ocr' | 'openai' | 'parser' | 'mapping';
  error: string;
  code: string;
} {
  if (error instanceof TenancyExtractionError) {
    return {
      stage: error.stage,
      error: safeErrorDetails(error).message,
      code: error.code
    };
  }

  const details = safeErrorDetails(error);
  return {
    stage: 'parser',
    error: details.message === 'unknown-error' ? 'The extraction pipeline failed before it could produce a readable tenancy record.' : details.message,
    code: details.code ?? 'extraction_pipeline_failed'
  };
}

function sanitizeStorageFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? 'document';
  const base = filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base || 'tenancy-agreement'}-${crypto.randomUUID()}.${extension}`;
}

export async function POST(request: Request) {
  let uploadedPath: string | null = null;
  let supabase: any;
  logExtractionDiagnostic('route_entered');

  try {
    const requestSizeError = rejectOversizedRequest(request, maxUploadBytes + 1024 * 1024);
    if (requestSizeError) return asNextJsonResponse(requestSizeError);
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return asNextJsonResponse(auth);
    ({ supabase } = auth);
    const { workspaceId } = auth;

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return uploadError('No file uploaded.', 'upload', 400);
    }

    logExtractionDiagnostic('file_received', {
      stage: 'upload',
      filename: file.name,
      fileType: file.type || 'unknown',
      fileSize: file.size
    });

    if (file.size > maxUploadBytes) {
      return uploadError('File is too large.', 'upload', 400);
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isDocx =
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.name.toLowerCase().endsWith('.docx');
    const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');

    if (!isPdf && !isDocx && !isTxt) {
      return uploadError('Unsupported file type.', 'upload', 400);
    }
    const config = getOpenAiConfiguration();
    const fileType = isPdf ? 'pdf' : isDocx ? 'docx' : 'txt';
    logExtractionDiagnostic('file_validated', {
      fileType,
      openAiConfigured: config.configured,
      openAiKeyPresent: config.keyPresent,
      configurationReason: config.reason,
      tenancyModel: config.tenancyModel,
      ocrModel: config.ocrModel
    });

    const storagePath = workspaceStoragePath(workspaceId, 'tenancy-agreements', sanitizeStorageFilename(file.name));
    const buffer = Buffer.from(await file.arrayBuffer());
    const documentHash = createHash('sha256').update(buffer).digest('hex');
    const mimeType = isPdf
      ? 'application/pdf'
      : isDocx
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'text/plain';
    if (!validateFileSignature(buffer, mimeType)) {
      return uploadError('File content does not match its type.', 'upload', 400);
    }
    const duplicate = await supabase.from('documents').select('id, processing_status')
      .eq('workspace_id', workspaceId).eq('document_hash', documentHash).maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) {
      return uploadError('duplicate-document', 'duplicate-check', 409, {
        documentId: duplicate.data.id,
        retryAllowed: ['ocr_required', 'extraction_failed'].includes(String(duplicate.data.processing_status))
      });
    }

    const upload = await supabase.storage.from(storageBucket).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false
    });

    if (upload.error) throw upload.error;
    uploadedPath = storagePath;
    logExtractionDiagnostic('document_persistence', { persisted: true, fileType });

    let extraction: Awaited<ReturnType<typeof extractTenancyFile>>;
    try {
      extraction = await extractTenancyFile({ buffer, filename: file.name, mimeType });
    } catch (error) {
      const failure = extractionFailureDetails(error);
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
          processingError: `${failure.stage}: ${failure.error}`,
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
      logExtractionFailure(`${failure.stage}_failed`, failure.error);
      logExtractionDiagnostic('extraction_failed', {
        stage: failure.stage,
        errorMessage: failure.error,
        fallbackReason: failure.code
      });
      logExtractionDiagnostic('document_persistence', { persisted: true, fallbackReason: failure.code });
      return uploadError(failure.error, failure.stage, 422, {
        documentId: saved.document.id,
        extractionId: saved.extraction.id, retryAllowed: true, rollbackStatus: 'document-preserved',
        message: {
          en: 'The document was saved, but extraction failed. Retry it from Document Centre.',
          zh: '文件已保存，但提取失败。请从文件中心重试。'
        },
        technicalReference: failure.code
      });
    }

    logExtractionDiagnostic('extraction_completed', {
      fileType,
      textLength: extraction.rawText.length,
      usedOcr: extraction.document.usedOcr,
      openAiConfigured: config.configured,
      openAiKeyPresent: config.keyPresent,
      configurationReason: config.reason,
      tenancyModel: config.tenancyModel,
      provider: extraction.provider,
      fallbackReason: extraction.fallbackReason
    });

    return NextResponse.json({
      success: true,
      provider: extraction.provider,
      model: extraction.provider === 'openai' ? extraction.document.model : null,
      fallbackUsed: extraction.fallbackUsed,
      fallbackReason: extraction.fallbackReason,
      documentId: String(upload.data?.id ?? upload.data?.path ?? ''),
      extraction,
      summary: extraction.summary,
      risks: extraction.legalIntelligence.risks,
      warnings: extraction.legalIntelligence.warnings,
      confidence: extraction.legalIntelligence.confidence,
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
    logExtractionFailure('route_failed', 'upload_or_persistence_failed');
    console.error('[tenancy-extraction] upload_route_failed', safeErrorDetails(error));

    if (uploadedPath) {
      try {
        await supabase?.storage.from(storageBucket).remove([uploadedPath]);
      } catch (cleanupError) {
        logExtractionFailure('document_cleanup_failed', 'storage_cleanup_failed');
      }
    }

    return uploadError(getApiErrorMessage(error), 'upload', 500);
  }
}
