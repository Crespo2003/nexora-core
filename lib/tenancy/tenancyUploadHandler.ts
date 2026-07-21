import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { extractTenancyFile } from '../ai/tenancyExtractor';
import { enrichExtractedTenancyTerms, type TenancyLegalIntelligence } from '../ai/extractTenancy';
import { getOpenAiConfiguration } from '../ai/openAiConfig';
import { logExtractionDiagnostic, logExtractionFailure } from '../ai/extractionDiagnostics';
import { validateFileSignature, workspaceStoragePath } from '../documents/upload';
import { formatNexoraDate } from '../dates/formatDate';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../supabase/server';
import { maxTenancyUploadBytes, maxTenancyUploadRequestBytes } from './uploadLimits';

const storageBucket = 'real-estate-documents';
const reusableExtractionStatuses = ['extraction_completed', 'completed', 'ready'];
const retryableDocumentStatuses = ['ocr_required', 'extraction_failed'];

/**
 * Explicit stage budgets so the route always answers well before the 300-second Vercel
 * function ceiling. The primary OpenAI request gets at most 90s and its single
 * transient-failure retry at most 60s; whatever wall-clock time earlier stages consumed
 * is subtracted so the total application budget never exceeds 240s.
 */
const uploadTimeBudget = Object.freeze({
  totalMs: 240_000,
  fileRetrievalMs: 20_000,
  textExtractionMs: 90_000,
  aiPrimaryMs: 90_000,
  aiRetryMs: 60_000,
  persistenceReserveMs: 20_000
});

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

type ExistingDocument = {
  id: string;
  processing_status: string | null;
  original_filename: string | null;
  sanitized_filename: string | null;
  storage_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  document_type: string | null;
  upload_status: string | null;
  document_hash: string | null;
};

type ExistingExtraction = {
  id: string;
  raw_text: string | null;
  extracted_json: unknown;
  confidence_json: unknown;
  ai_summary: string | null;
  ai_model: string | null;
  extraction_engine: string | null;
  extraction_status: string | null;
  created_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function reusableLegalIntelligence(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const nested = value.legalIntelligence ?? value.legal_intelligence;
  const legalIntelligence = isRecord(nested) ? nested : value;
  const hasRecognizedSection = ['tenant', 'landlord', 'property', 'financial', 'tenancy'].some((section) => isRecord(legalIntelligence[section]));
  return hasRecognizedSection ? legalIntelligence : null;
}

function storedExtractionForReview(
  extraction: ExistingExtraction,
  document: ExistingDocument
): Awaited<ReturnType<typeof extractTenancyFile>> {
  const storedLegal = reusableLegalIntelligence(extraction.extracted_json);
  if (!storedLegal) throw new Error('stored-extraction-invalid');

  const rawText = extraction.raw_text ?? '';
  // Re-apply enrichment so stale DB values from before the normalization fixes are corrected.
  const legalIntelligence = rawText
    ? enrichExtractedTenancyTerms(storedLegal as unknown as TenancyLegalIntelligence, rawText)
    : storedLegal;

  const provider = extraction.extraction_engine === 'openai' ? 'openai' : 'deterministic';

  return {
    provider,
    fallbackUsed: provider !== 'openai',
    fallbackReason: provider === 'openai' ? null : 'stored_extraction',
    rawText,
    summary: extraction.ai_summary ?? '',
    legalIntelligence,
    document: {
      originalFilename: document.original_filename ?? 'tenancy-agreement',
      uploadDate: formatNexoraDate(extraction.created_at),
      documentType: document.document_type ?? 'tenancy_agreement',
      extractionStatus: extraction.extraction_status ?? 'extraction_completed',
      extractionConfidence: 100,
      usedOcr: false,
      pageCount: null,
      chunkCount: 1,
      model: extraction.ai_model ?? null,
      fallbackReason: provider === 'openai' ? null : 'stored_extraction'
    }
  } as unknown as Awaited<ReturnType<typeof extractTenancyFile>>;
}

function normalizeFinalTenancyFinancials(
  extraction: Awaited<ReturnType<typeof extractTenancyFile>>
): Awaited<ReturnType<typeof extractTenancyFile>> {
  if (!extraction.rawText) return extraction;
  const enrichedLegal = enrichExtractedTenancyTerms(extraction.legalIntelligence, extraction.rawText);
  return { ...extraction, legalIntelligence: enrichedLegal };
}

function sanitizeStorageFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? 'document';
  const base = filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base || 'tenancy-agreement'}-${randomUUID()}.${extension}`;
}

type TenancyFileDescriptor = {
  filename: string;
  mimeType: string;
  isPdf: boolean;
  isDocx: boolean;
  isTxt: boolean;
};

function tenancyFileDescriptor(filename: string, suppliedMimeType: string): TenancyFileDescriptor | null {
  const lowerFilename = filename.toLowerCase();
  const isPdf = suppliedMimeType === 'application/pdf' || lowerFilename.endsWith('.pdf');
  const isDocx = suppliedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerFilename.endsWith('.docx');
  const isTxt = suppliedMimeType === 'text/plain' || lowerFilename.endsWith('.txt');
  if (!isPdf && !isDocx && !isTxt) return null;
  return {
    filename,
    mimeType: isPdf ? 'application/pdf' : isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain',
    isPdf,
    isDocx,
    isTxt
  };
}

function directUploadPathBelongsToWorkspace(storagePath: string, workspaceId: string): boolean {
  return storagePath.startsWith(`${workspaceId}/tenancy-agreements/`) && !storagePath.includes('..') && storagePath.length <= 1024;
}

function stringProperty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numericProperty(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
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

/** Transient AI/OCR failures the caller may safely retry against the preserved document. */
function retryableFailureCode(code: string): boolean {
  return ['openai_timeout', 'openai_rate_limited', 'openai_server_error', 'openai_request_failed', 'ocr_provider_timeout', 'ocr_provider_request_failed'].includes(code);
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
    'request-too-large': 'The tenancy upload exceeds the 50 MB limit.',
    'file-too-large': 'The tenancy file exceeds the 50 MB limit.',
    'unsupported-file-type': 'Only PDF, DOCX, and TXT tenancy agreements are supported.',
    'invalid-file-signature': 'The file content does not match the selected document type.',
    'duplicate-document': 'This document has already been uploaded to the active workspace.',
    'openai_timeout': 'AI extraction timed out; the deterministic fallback could not complete.',
    'text_extraction_failed': 'The document did not contain enough readable text for extraction.',
    'ocr_failed': 'OCR could not extract readable text from this document.',
    'ocr_not_configured': 'OCR is not configured for scanned document pages.',
    'ocr_provider_timeout': 'The OCR provider timed out while reading a scanned page.',
    'ocr_provider_request_failed': 'The OCR provider could not read a scanned page.',
    'ocr_malformed_or_empty_response': 'The OCR provider returned no readable text for a scanned page.',
    'ocr_page_preparation_failed': 'A scanned PDF page could not be prepared for OCR.',
    'ocr_page_out_of_range': 'A scanned PDF page could not be prepared for OCR.',
    'ocr_processing_failed': 'The OCR stage could not complete.',
    'invalid-upload-session': 'The uploaded file could not be verified for this workspace.',
    'uploaded-file-unavailable': 'The uploaded file is no longer available for processing.',
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
    let storagePath = '';
    let uploadedStorageReference = '';
    let existingDocument: ExistingDocument | null = null;
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
      const message = stableErrorMessage(code);
      return respond(status, {
        success: false,
        stage: failureStage,
        code,
        error: message,
        message,
        requestId,
        ...(code === 'request-too-large' || code === 'file-too-large' ? { maxUploadBytes: maxTenancyUploadBytes } : {}),
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
      const requestSizeError = dependencies.rejectOversizedRequest(request, maxTenancyUploadRequestBytes);
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

      const contentType = request.headers.get('content-type') ?? '';
      let fileName = '';
      let fileSize = 0;
      let mimeType = '';
      let isPdf = false;
      let isDocx = false;
      let isTxt = false;
      let buffer: Buffer;
      let directStorageUpload = false;

      if (contentType.includes('application/json')) {
        let payload: Record<string, unknown>;
        try {
          const body = await request.json();
          if (!isRecord(body)) return fail(400, 'validation', 'invalid-upload-session');
          payload = body;
        } catch {
          return fail(400, 'validation', 'invalid-upload-session');
        }

        const action = stringProperty(payload.action);
        fileName = stringProperty(payload.filename);
        const descriptor = tenancyFileDescriptor(fileName, stringProperty(payload.mimeType));
        fileSize = numericProperty(payload.fileSize);
        if (!descriptor || !Number.isInteger(fileSize) || fileSize <= 0) return fail(400, 'validation', 'unsupported-file-type');
        if (fileSize > maxTenancyUploadBytes) return fail(413, 'validation', 'file-too-large');

        if (action === 'prepare') {
          stage = 'storage';
          storagePath = dependencies.workspaceStoragePath(workspaceId, 'tenancy-agreements', sanitizeStorageFilename(fileName));
          const signedUpload = await supabase.storage.from(storageBucket).createSignedUploadUrl(storagePath);
          if (signedUpload.error || !signedUpload.data) throw signedUpload.error ?? new Error('signed-upload-unavailable');
          return respond(200, {
            success: true,
            action: 'prepare',
            requestId,
            maxUploadBytes: maxTenancyUploadBytes,
            upload: {
              signedUrl: signedUpload.data.signedUrl,
              storagePath,
              mimeType: descriptor.mimeType,
              fileSize
            }
          });
        }

        if (action !== 'finalize') return fail(400, 'validation', 'invalid-upload-session');
        storagePath = stringProperty(payload.storagePath);
        if (!directUploadPathBelongsToWorkspace(storagePath, workspaceId)) return fail(403, 'validation', 'invalid-upload-session');

        stage = 'storage';
        const downloadStartedAt = Date.now();
        const storage = supabase.storage.from(storageBucket);
        const storedInfo = await storage.info(storagePath);
        if (storedInfo.error || !storedInfo.data) return fail(422, stage, 'uploaded-file-unavailable');
        const storedSize = Number(storedInfo.data.size ?? storedInfo.data.metadata?.size);
        if (!Number.isFinite(storedSize) || storedSize <= 0) return fail(422, stage, 'uploaded-file-unavailable');
        if (storedSize > maxTenancyUploadBytes) {
          await storage.remove([storagePath]);
          return fail(413, 'validation', 'file-too-large');
        }
        const storedUpload = await storage.download(storagePath);
        if (storedUpload.error || !storedUpload.data) return fail(422, stage, 'uploaded-file-unavailable');
        fileSize = storedUpload.data.size;
        if (fileSize > maxTenancyUploadBytes) {
          await storage.remove([storagePath]);
          return fail(413, 'validation', 'file-too-large');
        }
        if (fileSize !== storedSize) return fail(422, stage, 'uploaded-file-unavailable');
        buffer = Buffer.from(await storedUpload.data.arrayBuffer());
        directStorageUpload = true;
        uploadedPath = storagePath;
        uploadedStorageReference = storagePath;
        logExtractionDiagnostic('document_download_completed', {
          requestId,
          stage,
          fileSize,
          elapsedMs: Date.now() - downloadStartedAt
        });
        logExtractionDiagnostic('storage_completed', {
          requestId,
          stage,
          fileSize,
          elapsedMs: Date.now() - downloadStartedAt
        });
      } else {
        stage = 'upload';
        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return fail(400, 'upload', 'invalid-multipart-body');
        }
        const file = formData.get('file');
        if (!(file instanceof File)) return fail(400, 'upload', 'missing-file');
        fileName = file.name;
        fileSize = file.size;
        const descriptor = tenancyFileDescriptor(fileName, file.type);
        if (!descriptor) return fail(400, 'validation', 'unsupported-file-type');
        mimeType = descriptor.mimeType;
        isPdf = descriptor.isPdf;
        isDocx = descriptor.isDocx;
        isTxt = descriptor.isTxt;
        if (fileSize > maxTenancyUploadBytes) return fail(413, 'validation', 'file-too-large');
        buffer = Buffer.from(await file.arrayBuffer());
      }

      const descriptor = tenancyFileDescriptor(fileName, mimeType);
      if (!descriptor) return fail(400, 'validation', 'unsupported-file-type');
      mimeType = descriptor.mimeType;
      isPdf = descriptor.isPdf;
      isDocx = descriptor.isDocx;
      isTxt = descriptor.isTxt;
      logExtractionDiagnostic('file_received', {
        requestId,
        stage: directStorageUpload ? 'storage' : 'upload',
        fileType: isPdf ? 'pdf' : isDocx ? 'docx' : 'txt',
        fileSize
      });

      stage = 'validation';
      if (!dependencies.validateFileSignature(buffer, mimeType)) {
        if (directStorageUpload) await supabase.storage.from(storageBucket).remove([storagePath]);
        return fail(400, stage, 'invalid-file-signature');
      }

      const config = dependencies.getOpenAiConfiguration();
      logExtractionDiagnostic('file_validated', {
        requestId,
        stage,
        fileType: isPdf ? 'pdf' : isDocx ? 'docx' : 'txt',
        fileSize,
        openAiConfigured: config.configured,
        tenancyModel: config.tenancyModel
      });

      const documentHash = createHash('sha256').update(buffer).digest('hex');
      stage = 'database';
      const duplicate = await supabase.from('documents').select('id, processing_status, original_filename, sanitized_filename, storage_path, mime_type, file_size, document_type, upload_status, document_hash')
        .eq('workspace_id', workspaceId).eq('document_hash', documentHash).maybeSingle();
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data) {
        existingDocument = duplicate.data as ExistingDocument;
        if (directStorageUpload && storagePath !== existingDocument.storage_path) {
          const cleanup = await supabase.storage.from(storageBucket).remove([storagePath]);
          if (cleanup.error) {
            logExtractionFailure('duplicate_upload_cleanup_failed', 'storage-cleanup-failed');
          }
          uploadedPath = null;
        }
        const latestExtraction = await supabase.from('document_extractions')
          .select('id, raw_text, extracted_json, confidence_json, ai_summary, ai_model, extraction_engine, extraction_status, created_at')
          .eq('workspace_id', workspaceId)
          .eq('document_id', existingDocument.id)
          .in('extraction_status', reusableExtractionStatuses)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestExtraction.error) throw latestExtraction.error;

        const reusableLegalData = reusableLegalIntelligence(latestExtraction.data?.extracted_json);
        const storedRawText = latestExtraction.data?.raw_text ?? '';
        if (latestExtraction.data && reusableLegalData && storedRawText) {
          const existingLink = await supabase.from('document_links')
            .select('entity_id')
            .eq('workspace_id', workspaceId)
            .eq('document_id', existingDocument.id)
            .eq('entity_type', 'tenancy')
            .eq('link_type', 'source_document')
            .limit(1)
            .maybeSingle();
          if (existingLink.error) throw existingLink.error;

          const extraction = normalizeFinalTenancyFinancials(storedExtractionForReview(latestExtraction.data as ExistingExtraction, existingDocument));
          stage = 'mapping';
          logExtractionDiagnostic('existing_document_reused', {
            requestId,
            stage,
            workspaceId,
            documentId: existingDocument.id,
            extractionId: latestExtraction.data.id,
            tenancyId: existingLink.data?.entity_id ?? null
          });
          return respond(200, {
            success: true,
            reused: true,
            requestId,
            provider: extraction.provider,
            model: extraction.provider === 'openai' ? extraction.document.model : null,
            fallbackUsed: extraction.fallbackUsed,
            fallbackReason: extraction.fallbackReason,
            documentId: existingDocument.id,
            extractionId: latestExtraction.data.id,
            tenancyId: existingLink.data?.entity_id ?? '',
            extraction,
            summary: extraction.summary,
            risks: extraction.legalIntelligence.risks,
            warnings: ['Existing document reused'],
            confidence: extraction.legalIntelligence.confidence,
            document: {
              originalFilename: existingDocument.original_filename ?? fileName,
              storagePath: existingDocument.storage_path ?? '',
              mimeType: existingDocument.mime_type ?? mimeType,
              fileSize: existingDocument.file_size ?? fileSize,
              documentType: existingDocument.document_type ?? extraction.document.documentType,
              uploadStatus: existingDocument.upload_status ?? 'uploaded',
              documentHash: existingDocument.document_hash ?? documentHash
            }
          });
        }

        const staleExtractionRequiresRecompute = Boolean(latestExtraction.data && reusableLegalData && !storedRawText && existingDocument.storage_path);
        if (!staleExtractionRequiresRecompute && (!retryableDocumentStatuses.includes(String(existingDocument.processing_status)) || !existingDocument.storage_path)) {
          return fail(409, 'database', 'duplicate-document', {
            documentId: existingDocument.id,
            retryAllowed: false
          });
        }
        if (!existingDocument.storage_path) {
          return fail(409, 'database', 'duplicate-document', {
            documentId: existingDocument.id,
            retryAllowed: false
          });
        }

        storagePath = existingDocument.storage_path;
        logExtractionDiagnostic('existing_document_retry_started', {
          requestId,
          stage,
          workspaceId,
          documentId: existingDocument.id,
          processingStatus: existingDocument.processing_status
        });
      } else {
        stage = 'storage';
        if (!directStorageUpload) {
          storagePath = dependencies.workspaceStoragePath(workspaceId, 'tenancy-agreements', sanitizeStorageFilename(fileName));
          const uploadStartedAt = Date.now();
          const upload = await supabase.storage.from(storageBucket).upload(storagePath, buffer, { contentType: mimeType, upsert: false });
          if (upload.error) throw upload.error;
          uploadedPath = storagePath;
          uploadedStorageReference = String(upload.data?.id ?? upload.data?.path ?? '');
          logExtractionDiagnostic('storage_completed', {
            requestId,
            stage,
            fileType: isPdf ? 'pdf' : isDocx ? 'docx' : 'txt',
            fileSize,
            elapsedMs: Date.now() - uploadStartedAt
          });
        }
        logExtractionDiagnostic('upload_success', {
          requestId,
          stage: 'storage',
          fileType: isPdf ? 'pdf' : isDocx ? 'docx' : 'txt',
          fileSize
        });
      }

      let extraction: Awaited<ReturnType<typeof extractTenancyFile>>;
      stage = isPdf ? 'pdf' : isDocx ? 'docx' : 'parser';
      let aiCallCount = 0;
      try {
        // The AI stage may only spend what remains of the total budget after upload,
        // storage, and validation, minus the persistence reserve; this guarantees the
        // route responds before the platform's 300-second ceiling.
        const elapsedBeforeExtraction = Date.now() - startedAt;
        const remainingForAi = uploadTimeBudget.totalMs - elapsedBeforeExtraction - uploadTimeBudget.persistenceReserveMs;
        const aiPrimaryTimeoutMs = Math.max(10_000, Math.min(uploadTimeBudget.aiPrimaryMs, remainingForAi));
        const aiRetryTimeoutMs = Math.max(5_000, Math.min(uploadTimeBudget.aiRetryMs, remainingForAi - aiPrimaryTimeoutMs));
        logExtractionDiagnostic('text_extraction_started', { requestId, stage, fileSize, elapsedMs: elapsedBeforeExtraction });
        extraction = await dependencies.extractTenancyFile({ buffer, filename: fileName, mimeType }, {
          // Smallest safe output budget for the consolidated single-call schema: strict
          // structured outputs force every key to be emitted (~900 tokens empty skeleton,
          // ~4,500-6,000 tokens for a fully populated agreement under the compact-output
          // caps), plus reasoning-token headroom on reasoning-capable models, which count
          // against max_output_tokens. 6,000 was sized for the old per-chunk partials and
          // caused status=incomplete/max_output_tokens (openai_truncated) on normal TAs.
          maxOutputTokens: 16_000,
          timeoutMs: aiPrimaryTimeoutMs,
          retryTimeoutMs: aiRetryTimeoutMs,
          maxAttempts: 2,
          requestId,
          onAiCallStart: () => { aiCallCount += 1; }
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
          aiCallCount,
          elapsedMs: Date.now() - startedAt
        });
        const sanitizedFilename = storagePath.split('/').pop() ?? 'tenancy-agreement';
        stage = 'database';
        const bundle = await supabase.rpc('upload_end_to_end_preserve_failed_upload', {
          p_workspace_id: workspaceId,
          p_payload: {
            originalFilename: fileName,
            sanitizedFilename,
            storageBucket,
            storagePath,
            mimeType,
            fileSize,
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
        // The stored document and extraction records remain available; retry runs against
        // the preserved storage object without re-uploading or duplicating the document.
        return fail(422, extractionStage, code, {
          documentId: saved.document.id,
          extractionId: saved.extraction.id,
          retryAllowed: true,
          retryable: retryableFailureCode(code),
          rollbackStatus: 'document-preserved'
        });
      }

      logExtractionDiagnostic('extraction_completed', {
        requestId,
        stage: 'mapping',
        textLength: extraction.rawText.length,
        usedOcr: extraction.document.usedOcr,
        pageCount: extraction.document.pageCount ?? undefined,
        provider: extraction.provider,
        fallbackReason: extraction.fallbackReason,
        aiCallCount,
        elapsedMs: Date.now() - startedAt
      });

      stage = 'mapping';
      logExtractionDiagnostic('deterministic_mapping_completed', {
        requestId,
        stage,
        aiCallCount,
        elapsedMs: Date.now() - startedAt
      });
      const finalExtraction = normalizeFinalTenancyFinancials(extraction);
      return respond(200, {
        success: true,
        reused: Boolean(existingDocument),
        requestId,
        provider: finalExtraction.provider,
        model: finalExtraction.provider === 'openai' ? finalExtraction.document.model : null,
        fallbackUsed: finalExtraction.fallbackUsed,
        fallbackReason: finalExtraction.fallbackReason,
        documentId: existingDocument?.id ?? uploadedStorageReference,
        extractionId: '',
        tenancyId: '',
        extraction: finalExtraction,
        summary: finalExtraction.summary,
        risks: finalExtraction.legalIntelligence.risks,
        warnings: existingDocument ? ['Existing document reused'] : finalExtraction.legalIntelligence.warnings,
        confidence: finalExtraction.legalIntelligence.confidence,
        document: {
          originalFilename: existingDocument?.original_filename ?? fileName,
          storagePath,
          mimeType: existingDocument?.mime_type ?? mimeType,
          fileSize: existingDocument?.file_size ?? fileSize,
          documentType: existingDocument?.document_type ?? finalExtraction.document.documentType,
          uploadStatus: existingDocument?.upload_status ?? 'uploaded',
          documentHash: existingDocument?.document_hash ?? documentHash
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
