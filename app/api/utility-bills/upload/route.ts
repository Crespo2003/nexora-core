import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { extractUtilityBill } from '../../../../lib/collections/core';
import { currentIsoMonth } from '../../../../lib/dates/formatDate';
import { extractDocumentText } from '../../../../lib/documents/extractText';
import { inferMimeTypeFromName, validateExtensionMatchesMime, validateFileSignature, workspaceStoragePath } from '../../../../lib/documents/upload';
import { maxDocumentUploadBytes } from '../../../../lib/documents/types';
import { checkUploadRateLimit } from '../../../../lib/security/uploadRateLimit';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const allowedMimeTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
];

export async function POST(request: Request) {
  const affectedRecordIds: string[] = [];
  let storagePath: string | null = null;
  let persistedDocumentId: string | null = null;
  let supabase: any;

  try {
    const requestSizeError = rejectOversizedRequest(request, maxDocumentUploadBytes + 1024 * 1024);
    if (requestSizeError) return requestSizeError;
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent', 'finance'], request);
    if (auth instanceof Response) return auth;
    ({ supabase } = auth);
    const { workspaceId, user } = auth;
    const rateLimit = checkUploadRateLimit(`${workspaceId}:${user.id}`);
    if (!rateLimit.allowed) return NextResponse.json({
      success: false, failedStage: 'rate-limit', affectedRecordIds, rollbackStatus: 'not-required',
      message: { en: 'Upload limit reached. Try again shortly.', zh: '上传次数已达限制，请稍后再试。' }, technicalReference: 'utility-upload-rate-limit'
    }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } });

    const data = await request.formData();
    const file = data.get('file');
    const tenancyId = String(data.get('tenancyId') ?? '');
    const rentalCollectionId = String(data.get('rentalCollectionId') ?? '');
    const provider = String(data.get('provider') ?? 'other');
    const createCollectionIfMissing = String(data.get('createCollectionIfMissing') ?? 'true') !== 'false';
    const collectionMonth = String(data.get('collectionMonth') ?? '');

    if (!(file instanceof File) || !tenancyId) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds,
        rollbackStatus: 'not-required',
        message: { en: 'A utility bill file and tenancy are required.', zh: '必须上传水电账单并选择租约。' },
        technicalReference: 'invalid-utility-upload'
      }, { status: 400 });
    }

    const mimeType = file.type || inferMimeTypeFromName(file.name);
    if (!allowedMimeTypes.includes(mimeType)) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds,
        rollbackStatus: 'not-required',
        message: { en: 'Unsupported utility bill file type.', zh: '不支持此账单文件类型。' },
        technicalReference: 'unsupported-utility-file'
      }, { status: 400 });
    }
    if (!validateExtensionMatchesMime(file.name, mimeType)) {
      return NextResponse.json({ success: false, failedStage: 'validation', affectedRecordIds, rollbackStatus: 'not-required', message: { en: 'The filename extension does not match the file type.', zh: '文件扩展名与文件类型不匹配。' }, technicalReference: 'utility-extension-mismatch' }, { status: 400 });
    }

    if (file.size > maxDocumentUploadBytes) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds,
        rollbackStatus: 'not-required',
        message: { en: 'Utility bill file is too large.', zh: 'Utility bill file is too large.' },
        technicalReference: 'utility-file-too-large'
      }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!validateFileSignature(buffer, mimeType)) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds,
        rollbackStatus: 'not-required',
        message: { en: 'Utility bill content does not match its file type.', zh: 'Utility bill content does not match its file type.' },
        technicalReference: 'utility-file-content-mismatch'
      }, { status: 400 });
    }
    const documentHash = createHash('sha256').update(buffer).digest('hex');
    const duplicateDocument = await supabase.from('documents').select('id').eq('workspace_id', workspaceId).eq('document_hash', documentHash).maybeSingle();
    if (duplicateDocument.error && duplicateDocument.error.code !== '42703') throw duplicateDocument.error;
    if (duplicateDocument.data) {
      return NextResponse.json({
        success: false,
        failedStage: 'duplicate-check',
        affectedRecordIds,
        rollbackStatus: 'not-required',
        message: { en: 'This utility bill file was already uploaded.', zh: '此水电账单文件已经上传。' },
        technicalReference: 'duplicate-document-hash'
      }, { status: 409 });
    }

    storagePath = workspaceStoragePath(workspaceId, 'utility-bills', file.name);
    const upload = await supabase.storage.from('real-estate-documents').upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    if (upload.error) throw upload.error;

    const textResult = await extractDocumentText({ buffer, mimeType, filename: file.name });
    const rawText = textResult.text;
    const extraction = extractUtilityBill(rawText, file.name);
    const reviewedProvider = extraction.provider === 'not_detected' ? provider : extraction.provider;
    const billMonth = normalizeBillMonth(extraction.billingPeriod, normalizeExtractedDate(extraction.billDate))
      || collectionMonth.slice(0, 7)
      || currentIsoMonth();

    const documentInsert = await supabase
      .from('documents')
      .insert({
        original_filename: file.name,
        workspace_id: workspaceId,
        sanitized_filename: storagePath.split('/').at(-1) ?? file.name,
        storage_bucket: 'real-estate-documents',
        storage_path: storagePath,
        mime_type: mimeType,
        file_size: file.size,
        document_type: 'utility_bill',
        upload_status: 'uploaded',
        processing_status: rawText ? 'pending_review' : 'extraction_failed',
        document_hash: documentHash,
        processing_attempts: textResult.usedOcr ? 1 : 0,
        last_processing_error: textResult.error,
        processing_started_at: new Date().toISOString()
      })
      .select('id')
      .single();
    if (documentInsert.error) throw documentInsert.error;
    persistedDocumentId = documentInsert.data.id;
    affectedRecordIds.push(documentInsert.data.id);

    const documentLink = await supabase.from('document_links').insert({
      document_id: documentInsert.data.id,
      workspace_id: workspaceId,
      entity_type: 'tenancy',
      entity_id: tenancyId,
      link_type: 'utility_bill'
    });
    if (documentLink.error) throw documentLink.error;
    await supabase.from('documents').update({ linked_status: 'linked' }).eq('id', documentInsert.data.id);

    const extractionInsert = await supabase
      .from('document_extractions')
      .insert({
        document_id: documentInsert.data.id,
        workspace_id: workspaceId,
        extraction_version: 'utility-fallback-v1',
        raw_text: rawText,
        extracted_json: { ...extraction, provider: reviewedProvider, billMonth },
        confidence_json: { overall: extraction.confidence },
        ai_summary: `Utility bill extraction: ${extraction.confidence}`,
        extraction_status: rawText ? 'pending_review' : 'extraction_failed',
        extraction_error: textResult.error || null,
        completed_at: new Date().toISOString()
      })
      .select('id')
      .single();
    if (extractionInsert.error) throw extractionInsert.error;
    affectedRecordIds.push(extractionInsert.data.id);

    const activityInsert = await supabase.from('activity_logs').insert([
      {
        entity_type: 'document', entity_id: documentInsert.data.id, workspace_id: workspaceId,
        activity_type: 'document_uploaded', activity_json: { tenancyId, filename: file.name, documentType: 'utility_bill' }
      },
      {
        entity_type: 'document', entity_id: documentInsert.data.id, workspace_id: workspaceId,
        activity_type: rawText ? 'extraction_completed' : 'extraction_failed',
        activity_json: { tenancyId, provider: reviewedProvider, confidence: extraction.confidence }
      }
    ]);
    if (activityInsert.error) throw activityInsert.error;

    if (!rawText) {
      return NextResponse.json({
        success: false,
        failedStage: 'ocr',
        affectedRecordIds,
        rollbackStatus: 'document-preserved',
        message: { en: textResult.status === 'not_configured' ? 'Bill saved, but OCR is not configured.' : 'Bill saved, but extraction failed. You can retry.', zh: textResult.status === 'not_configured' ? '账单已保存，但尚未配置 OCR。' : '账单已保存，但提取失败。您可以重试。' },
        technicalReference: textResult.error || 'utility-upload-extraction-failed',
        documentId: documentInsert.data.id,
        extraction,
        retryAllowed: true
      }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      failedStage: null,
      affectedRecordIds,
      rollbackStatus: 'not-required',
      message: { en: 'Utility bill extracted. Review and confirm before records are updated.', zh: '水电账单已提取。请检查并确认后再更新记录。' },
      technicalReference: 'utility-upload-review-required',
      documentId: documentInsert.data.id,
      extraction: { ...extraction, provider: reviewedProvider, billMonth },
      requiresConfirmation: true,
      rentalCollectionId: rentalCollectionId || null,
      createCollectionIfMissing
    });
  } catch (error) {
    console.error('Utility bill upload failed');
    if (storagePath && !persistedDocumentId) {
      try { await supabase?.storage.from('real-estate-documents').remove([storagePath]); } catch { /* Best-effort orphan cleanup. */ }
    }
    return NextResponse.json({
      success: false,
      failedStage: 'server',
      affectedRecordIds,
      rollbackStatus: persistedDocumentId ? 'document-preserved' : 'storage-cleanup-attempted',
      message: { en: persistedDocumentId ? 'Bill was saved, but processing did not finish. Retry from review.' : 'Utility bill upload failed.', zh: persistedDocumentId ? '账单已保存，但处理尚未完成。请从检查页面重试。' : '水电账单上传失败。' },
      technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}

function normalizeExtractedDate(value: string) {
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function normalizeBillMonth(value: string, billDate: string | null) {
  if (billDate) return billDate.slice(0, 7);
  const numeric = value.match(/(\d{4})[-/]?(\d{1,2})|(?:(\d{1,2})[-/](\d{4}))/);
  if (numeric) {
    const year = numeric[1] || numeric[4];
    const month = numeric[2] || numeric[3];
    return `${year}-${month.padStart(2, '0')}`;
  }
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const named = value.toLowerCase().match(new RegExp(`(${monthNames.join('|')})\\s+(\\d{4})`));
  if (!named) return '';
  return `${named[2]}-${String(monthNames.indexOf(named[1]) + 1).padStart(2, '0')}`;
}
