import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { extractTenancyFile } from '../ai/tenancyExtractor';
import { getOpenAiConfiguration } from '../ai/openAiConfig';
import { logExtractionDiagnostic, logExtractionFailure } from '../ai/extractionDiagnostics';
import { validateFileSignature, workspaceStoragePath } from '../documents/upload';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../supabase/server';

const maxUploadBytes = 10 * 1024 * 1024;
const storageBucket = 'real-estate-documents';

type UploadStage = 'auth' | 'upload' | 'validation' | 'storage' | 'pdf' | 'docx' | 'ocr' | 'openai' | 'parser' | 'mapping' | 'database' | 'unknown';
type UploadDependencies = {
  extractTenancyFile: typeof extractTenancyFile;
  validateFileSignature: typeof validateFileSignature;
  workspaceStoragePath: typeof workspaceStoragePath;
  requireWorkspaceAccess: typeof requireWorkspaceAccess;
  rejectOversizedRequest: typeof rejectOversizedRequest;
  getOpenAiConfiguration: typeof getOpenAiConfiguration;
};

const defaultDependencies: UploadDependencies = {
  extractTenancyFile,
  validateFileSignature,
  workspaceStoragePath,
  requireWorkspaceAccess,
  rejectOversizedRequest,
  getOpenAiConfiguration
};

function sanitizeStorageFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? 'document';
  const base = filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base || 'tenancy-agreement'}-${randomUUID()}.${extension}`;
}

function stageForExtractionError(error: unknown, mimeType: string): UploadStage {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.message : '';
  if (/ocr/i.test(code)) return 'ocr';
  if (/openai|ai_response|invalid_ai/i.test(code)) return 'openai';
  if (/mapping/i.test(code)) return 'mapping';
  if (/pdf|password-protected/i.test(code)) return 'pdf';
  if (/docx|wordprocessing/i.test(code)) return 'docx';
  return mimeType === 'application/pdf' ? 'pdf' : mimeType.includes('wordprocessingml') ? 'docx' : 'parser';
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return getApiErrorMessage(error);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function stableErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    'authentication-required': 'Authentication is required to upload a tenancy agreement.',
    'workspace-required': 'An active workspace is required to upload a tenancy agreement.',
    'permission-denied': 'You do not have permission to upload tenancy agreements.',
    'cross-site-request-blocked': 'This upload request was blocked by origin protection.',
    'request-too-large': 'The upload request is too large.',
    'file-too-large': 'The uploaded file is too large.',
    'unsupported-file-type': 'Only PDF, DOCX, and TXT tenancy agreements are supported.',
    'invalid-file-signature': 'The file content does not match the selected document type.',
    'duplicate-document': 'This document has already been uploaded to the active workspace.',
    'openai_timeout': 'AI extraction timed out; the deterministic fallback could not complete.',
    'text_extraction_failed': 'The document did not contain enough readable text for extraction.',
    'ocr_failed': 'OCR could not extract readable text from this document.',
    'database-unavailable': 'The document service is temporarily unavailable.',
    'request-failed': 'The tenancy upload could not be completed.'
  };
  return messages[code] ?? 'The tenancy upload could not be completed.';
}

export function createTenancyUploadHandler(overrides: Partial<UploadDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return async function POST(request: Request) {
    const requestId = request.headers.get('x-vercel-id') ?? randomUUID();
    const startedAt = Date.now();
    let stage: UploadStage = 'upload';
    let uploadedPath: string | null = null;
    let supabase: any;

    const respond = (status: number, payload: Record<string, unknown>) => {
      logExtractionDiagnostic('http_response', {
        requestId,
        stage,
        statusCode: status,
        elapsedMs: Date.now() - startedAt,
        errorCode: typeof payload.code === 'string' ? payload.code : undefined
      });
      return NextResponse.json(payload, {
        status,
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Request-ID': requestId
        }
      });
    };

    const fail = (status: number, failureStage: UploadStage, code: string, extras: Record<string, unknown> = {}) => {
      stage = failureStage;
      return respond(status, {
        success: false,
        stage: failureStage,
        code,
        error: stableErrorMessage(code),
        requestId,
        ...extras
      });
    };

    const normalizeGuardResponse = async (response: Response, failureStage: UploadStage) => {
      let code = 'request-failed';
      try {
        const payload = await response.clone().json() as { error?: unknown };
        if (typeof payload.error === 'string') code = payload.error;
      } catch {
        // The route controls the response returned to the browser even if a guard did not.
      }
      return fail(response.status || 500, failureStage, code);
    };

    logExtractionDiagnostic('route_entered', { requestId, stage: 'upload' });

    try {
      stage = 'validation';
      const requestSizeError = dependencies.rejectOversizedRequest(request, maxUploadBytes + 1024 * 1024);
      if (requestSizeError) return normalizeGuardResponse(requestSizeError, 'validation');

      stage = 'auth';
      const auth = await dependencies.requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
      if (auth instanceof Response) {
        logExtractionDiagnostic('authentication_completed', { requestId, stage, authenticated: false });
        return normalizeGuardResponse(auth, 'auth');
      }
      ({ supabase } = auth);
      const { workspaceId, role } = auth;
      logExtractionDiagnostic('authentication_completed', {
        requestId,
        stage,
        authenticated: true,
        workspaceId,
        role
      });

      stage = 'upload';
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return fail(400, 'upload', 'invalid-multipart-body');
      }
      const file = formData.get('file');
      if (!(file instanceof File)) return fail(400, 'upload', 'missing-file');

      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.toLowerCase().endsWith('.docx');
      const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
      const mimeType = isPdf ? 'application/pdf' : isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain';

      logExtractionDiagnostic('file_received', {
        requestId,
        stage: 'upload',
        fileType: isPdf ? 'pdf' : isDocx ? 'docx' : isTxt ? 'txt' : 'unsupported',
        fileSize: file.size
      });

      stage = 'validation';
      if (!isPdf && !isDocx && !isTxt) return fail(400, stage, 'unsupported-file-type');
      if (file.size > maxUploadBytes) return fail(413, stage, 'file-too-large');

      const buffer = Buffer.from(await file.arrayBuffer());
      if (!dependencies.validateFileSignature(buffer, mimeType)) return fail(400, stage, 'invalid-file-signature');

      const config = dependencies.getOpenAiConfiguration();
      logExtractionDiagnostic('file_validated', {
        requestId,
        stage,
        fileType: isPdf ? 'pdf' : isDocx ? 'docx' : 'txt',
        fileSize: file.size,
        openAiConfigured: config.configured,
        tenancyModel: config.tenancyModel
      });

      const documentHash = createHash('sha256').update(buffer).digest('hex');
      stage = 'database';
      const duplicate = await supabase.from('documents').select('id, processing_status')
        .eq('workspace_id', workspaceId).eq('document_hash', documentHash).maybeSingle();
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data) {
        return fail(409, 'database', 'duplicate-document', {
          documentId: duplicate.data.id,
          retryAllowed: ['ocr_required', 'extraction_failed'].includes(String(duplicate.data.processing_status))
        });
      }

      stage = 'storage';
      const storagePath = dependencies.workspaceStoragePath(workspaceId, 'tenancy-agreements', sanitizeStorageFilename(file.name));
      const uploadStartedAt = Date.now();
      const upload = await supabase.storage.from(storageBucket).upload(storagePath, buffer, { contentType: mimeType, upsert: false });
      if (upload.error) throw upload.error;
      uploadedPath = storagePath;
      logExtractionDiagnostic('storage_completed', {
        requestId,
        stage,
        fileType: isPdf ? 'pdf' : isDocx ? 'docx' : 'txt',
        fileSize: file.size,
        elapsedMs: Date.now() - uploadStartedAt
      });

      let extraction: Awaited<ReturnType<typeof extractTenancyFile>>;
      stage = isPdf ? 'pdf' : isDocx ? 'docx' : 'parser';
      try {
        extraction = await dependencies.extractTenancyFile({ buffer, filename: file.name, mimeType }, {
          maxOutputTokens: 6_000,
          timeoutMs: 120_000,
          maxAttempts: 2,
          requestId
        });
      } catch (error) {
        const extractionStage = stageForExtractionError(error, mimeType);
        const code = errorCode(error);
        logExtractionFailure('extraction_failed', code);
        logExtractionDiagnostic('extraction_failed', {
          requestId,
          stage: extractionStage,
          errorName: errorName(error),
          errorCode: code,
          elapsedMs: Date.now() - startedAt
        });
        const sanitizedFilename = storagePath.split('/').pop() ?? 'tenancy-agreement';
        stage = 'database';
        const bundle = await supabase.rpc('upload_end_to_end_preserve_failed_upload', {
          p_workspace_id: workspaceId,
          p_payload: {
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
            processingError: code,
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
        return fail(422, extractionStage, code, {
          documentId: saved.document.id,
          extractionId: saved.extraction.id,
          retryAllowed: true,
          rollbackStatus: 'document-preserved'
        });
      }

      logExtractionDiagnostic('extraction_completed', {
        requestId,
        stage: 'mapping',
        textLength: extraction.rawText.length,
        usedOcr: extraction.document.usedOcr,
        provider: extraction.provider,
        fallbackReason: extraction.fallbackReason,
        elapsedMs: Date.now() - startedAt
      });

      stage = 'mapping';
      return respond(200, {
        success: true,
        requestId,
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
      const code = errorCode(error);
      logExtractionFailure('route_failed', code);
      logExtractionDiagnostic('route_failed', {
        requestId,
        stage,
        errorName: errorName(error),
        errorCode: code,
        elapsedMs: Date.now() - startedAt
      });
      if (uploadedPath) {
        try {
          await supabase?.storage.from(storageBucket).remove([uploadedPath]);
        } catch {
          logExtractionFailure('document_cleanup_failed', 'storage-cleanup-failed');
        }
      }
      const failureStage: UploadStage = stage === 'database' || stage === 'storage' ? stage : 'unknown';
      return fail(500, failureStage, code);
    }
  };
}
