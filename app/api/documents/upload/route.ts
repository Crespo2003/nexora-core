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
      ? extractTenancyDetails(rawText, file.name, mimeType)
      : null;
    const extractionStatus = textResult.status === 'completed' && rawText ? 'pending_review' : 'extraction_failed';

    const autoPopulation = tenancyExtraction && tenancyId
      ? tenancyChangesFromExtraction(tenancyExtraction)
      : { changes: {}, lowConfidenceFields: [] as string[] };
    const bundle = await supabase.rpc('sprint_005_create_document_bundle', {
      p_workspace_id: workspaceId,
      p_payload: {
        tenancyId: tenancyId || null,
        originalFilename: file.name,
        sanitizedFilename,
        storageBucket,
        storagePath,
        mimeType,
        fileSize: file.size,
        documentType,
        processingStatus: extractionStatus,
        documentHash,
        processingAttempts: textResult.usedOcr ? 1 : 0,
        processingError: textResult.error,
        rawText,
        extractedJson: tenancyExtraction ?? {},
        confidenceJson: tenancyExtraction ?? { classification },
        aiSummary: tenancyExtraction?.summary ?? (textResult.error ? 'Document processing requires attention.' : 'Document extracted and awaiting confirmation.'),
        lowConfidenceFields: autoPopulation.lowConfidenceFields
      }
    });
    if (bundle.error) throw bundle.error;
    const bundleData = bundle.data as { document: Record<string, unknown> & { id: string }; extraction: Record<string, unknown> & { id: string } };
    const documentInsert = { data: bundleData.document };
    const extractionInsert = { data: bundleData.extraction };
    persistedDocumentId = documentInsert.data.id;

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
