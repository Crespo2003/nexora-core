import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { classifyDocument } from '../../../../lib/ai/documentClassifier';
import { extractTenancyDetails } from '../../../../lib/ai/tenancyExtractor';
import { extractDocumentText } from '../../../../lib/documents/extractText';
import { inferMimeTypeFromName, validateExtensionMatchesMime, validateFileSignature, workspaceStoragePath } from '../../../../lib/documents/upload';
import { allowedDocumentMimeTypes, maxDocumentUploadBytes } from '../../../../lib/documents/types';
import { checkUploadRateLimit } from '../../../../lib/security/uploadRateLimit';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';
import { tenancyChangesFromExtraction } from '../../../../lib/tenancy-workspace/automation';

const storageBucket = 'real-estate-documents';

export const maxDuration = 300;

export async function POST(request: Request) {
  let storagePath: string | null = null;
  let persistedDocumentId: string | null = null;
  let supabase: any;

  try {
    const requestSizeError = rejectOversizedRequest(request, maxDocumentUploadBytes + 1024 * 1024);
    if (requestSizeError) return requestSizeError;
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    ({ supabase } = auth);
    const { workspaceId, user } = auth;
    const rateLimit = checkUploadRateLimit(`${workspaceId}:${user.id}`);
    if (!rateLimit.allowed) return NextResponse.json({
      success: false, failedStage: 'rate-limit', affectedRecordIds: [], rollbackStatus: 'not-required',
      message: { en: 'Upload limit reached. Try again shortly.', zh: '上传次数已达限制，请稍后再试。' },
      technicalReference: 'document-upload-rate-limit'
    }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } });

    const formData = await request.formData();
    const file = formData.get('file');
    const selectedDocumentType = String(formData.get('documentType') ?? '');
    const tenancyId = String(formData.get('tenancyId') ?? '');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'no-file', stage: 'upload' }, { status: 400 });
    }

    if (tenancyId) {
      const tenancy = await supabase.from('tenancies').select('id').eq('id', tenancyId).eq('workspace_id', workspaceId).maybeSingle();
      if (tenancy.error) throw tenancy.error;
      if (!tenancy.data) return NextResponse.json({ error: 'tenancy-not-found', stage: 'upload' }, { status: 404 });
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
    if (!validateExtensionMatchesMime(file.name, mimeType)) {
      return NextResponse.json({
        success: false, failedStage: 'validation', affectedRecordIds: [], rollbackStatus: 'not-required',
        message: { en: 'The filename extension does not match the file type.', zh: '文件扩展名与文件类型不匹配。' },
        technicalReference: 'file-extension-mismatch'
      }, { status: 400 });
    }
    const documentHash = createHash('sha256').update(buffer).digest('hex');
    const duplicate = await supabase.from('documents').select('id').eq('workspace_id', workspaceId).eq('document_hash', documentHash).maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) {
      return NextResponse.json({ error: 'duplicate-document', stage: 'duplicate-check', documentId: duplicate.data.id }, { status: 409 });
    }
    storagePath = workspaceStoragePath(workspaceId, selectedDocumentType || 'document-centre', file.name);
    const sanitizedFilename = storagePath.split('/').pop() ?? file.name;

    const upload = await supabase.storage.from(storageBucket).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false
    });

    if (upload.error) throw upload.error;

    const textResult = await extractDocumentText({ buffer, filename: file.name, mimeType });
    const rawText = textResult.text;
    const classification = classifyDocument(rawText, file.name, mimeType);
    const documentType = classification.confidence === 'low' && selectedDocumentType
      ? selectedDocumentType
      : classification.documentType;
    const tenancyExtraction = documentType === 'tenancy_agreement' && rawText
      ? await extractTenancyDetails(rawText, file.name, mimeType)
      : null;
    const extractionStatus = textResult.status === 'completed' && rawText ? 'pending_review' : 'extraction_failed';

    const autoPopulation = tenancyExtraction && tenancyId
      ? tenancyChangesFromExtraction(tenancyExtraction)
      : { changes: {}, lowConfidenceFields: [] as string[] };
    const aiSummary = tenancyExtraction?.summary ?? (textResult.error ? 'Document processing requires attention.' : 'Document extracted and awaiting confirmation.');

    const docResult = await supabase.from('documents').insert({
      workspace_id: workspaceId,
      owner_user_id: user.id,
      original_filename: file.name,
      sanitized_filename: sanitizedFilename,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      mime_type: mimeType,
      file_size: file.size,
      document_type: documentType,
      upload_status: 'uploaded',
      processing_status: extractionStatus,
      linked_status: tenancyId ? 'linked' : 'unlinked',
      document_hash: documentHash,
    }).select().single();
    if (docResult.error) throw docResult.error;
    persistedDocumentId = docResult.data.id;

    const extractResult = await supabase.from('document_extractions').insert({
      document_id: docResult.data.id,
      workspace_id: workspaceId,
      extraction_version: 'fallback-v1',
      raw_text: rawText ?? '',
      extracted_json: tenancyExtraction ?? {},
      confidence_json: tenancyExtraction ?? { classification },
      ai_summary: aiSummary,
      extraction_status: extractionStatus,
      extraction_error: textResult.error ?? null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).select().single();
    if (extractResult.error) throw extractResult.error;

    if (tenancyId) {
      await supabase.from('document_links').insert({
        document_id: docResult.data.id,
        workspace_id: workspaceId,
        entity_type: 'tenancy',
        entity_id: tenancyId,
        link_type: 'source_document',
      });
    }

    await supabase.from('document_activity').insert({
      document_id: docResult.data.id,
      workspace_id: workspaceId,
      activity_type: extractionStatus === 'pending_review' ? 'extraction_completed' : 'extraction_failed',
      activity_json: { filename: file.name, extractionStatus, tenancyId: tenancyId || null },
    });

    const documentInsert = { data: docResult.data };
    const extractionInsert = { data: extractResult.data };

    if (extractionStatus === 'extraction_failed') return NextResponse.json({
      success: false, failedStage: 'ocr', affectedRecordIds: [documentInsert.data.id, extractionInsert.data.id], rollbackStatus: 'document-preserved',
      message: { en: textResult.status === 'not_configured' ? 'Document saved, but OCR is not configured.' : 'Document saved, but extraction failed. You can retry.', zh: textResult.status === 'not_configured' ? '文件已保存，但尚未配置 OCR。' : '文件已保存，但提取失败。您可以重试。' },
      technicalReference: textResult.error || 'document-extraction-failed', document: documentInsert.data, extraction: extractionInsert.data, retryAllowed: true
    }, { status: 422 });

    return NextResponse.json({
      success: true, failedStage: null, affectedRecordIds: [documentInsert.data.id, extractionInsert.data.id], rollbackStatus: 'not-required',
      message: { en: 'Document extracted. Review and confirm before records are updated.', zh: '文件已提取。请检查并确认后再更新记录。' },
      technicalReference: 'document-upload-review-required',
      document: documentInsert.data,
      extraction: extractionInsert.data,
      classification,
      ocrRequired: textResult.usedOcr,
      pendingConfirmationFields: Object.keys(autoPopulation.changes),
      lowConfidenceFields: autoPopulation.lowConfidenceFields
    });
  } catch (error) {
    if (storagePath && !persistedDocumentId) {
      try {
        await supabase?.storage.from(storageBucket).remove([storagePath]);
      } catch (cleanupError) {
        console.error('Document Centre upload cleanup failed');
      }
    }

    return NextResponse.json({
      success: false, failedStage: persistedDocumentId ? 'post-upload-processing' : 'upload',
      affectedRecordIds: persistedDocumentId ? [persistedDocumentId] : [],
      rollbackStatus: persistedDocumentId ? 'document-preserved' : 'storage-cleanup-attempted',
      message: { en: persistedDocumentId ? 'Document was saved, but processing did not finish. Retry from the review screen.' : 'Document upload failed.', zh: persistedDocumentId ? '文件已保存，但处理尚未完成。请从检查页面重试。' : '文件上传失败。' },
      technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
