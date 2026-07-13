import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { extractUtilityBill } from '../../../../lib/collections/core';
import { parseDocx } from '../../../../lib/documents/parseDocx';
import { parsePdf } from '../../../../lib/documents/parsePdf';
import { inferMimeTypeFromName, validateFileSignature, workspaceStoragePath } from '../../../../lib/documents/upload';
import { maxDocumentUploadBytes } from '../../../../lib/documents/types';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const allowedMimeTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
];

async function extractText(buffer: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') return parsePdf(buffer);
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return parseDocx(buffer);
  return '';
}

export async function POST(request: Request) {
  const affectedRecordIds: string[] = [];

  try {
    const requestSizeError = rejectOversizedRequest(request, maxDocumentUploadBytes + 1024 * 1024);
    if (requestSizeError) return requestSizeError;
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent', 'finance'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;

    const data = await request.formData();
    const file = data.get('file');
    const tenancyId = String(data.get('tenancyId') ?? '');
    const rentalCollectionId = String(data.get('rentalCollectionId') ?? '');
    const provider = String(data.get('provider') ?? 'other');
    const createCollectionIfMissing = String(data.get('createCollectionIfMissing') ?? 'false') === 'true';
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
    const duplicateDocument = await supabase.from('documents').select('id').eq('document_hash', documentHash).maybeSingle();
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

    const storagePath = workspaceStoragePath(workspaceId, 'utility-bills', file.name);
    const upload = await supabase.storage.from('real-estate-documents').upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    if (upload.error) throw upload.error;

    const rawText = await extractText(buffer, mimeType);
    const extraction = extractUtilityBill(rawText, file.name);
    const reviewedProvider = extraction.provider === 'not_detected' ? provider : extraction.provider;

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
        processing_status: rawText ? 'pending_review' : 'ocr_required',
        document_hash: documentHash
      })
      .select('id')
      .single();
    if (documentInsert.error) throw documentInsert.error;
    affectedRecordIds.push(documentInsert.data.id);

    const extractionInsert = await supabase
      .from('document_extractions')
      .insert({
        document_id: documentInsert.data.id,
        workspace_id: workspaceId,
        extraction_version: 'utility-fallback-v1',
        raw_text: rawText,
        extracted_json: extraction,
        confidence_json: { overall: extraction.confidence },
        ai_summary: `Utility bill extraction: ${extraction.confidence}`,
        extraction_status: rawText ? 'pending_review' : 'ocr_required',
        completed_at: new Date().toISOString()
      })
      .select('id')
      .single();
    if (extractionInsert.error) throw extractionInsert.error;
    affectedRecordIds.push(extractionInsert.data.id);

    if (!rawText) {
      return NextResponse.json({
        success: true,
        failedStage: 'ocr-required',
        affectedRecordIds,
        rollbackStatus: 'not-required',
        message: { en: 'Bill uploaded. OCR review is required before collection updates.', zh: '账单已上传。需要 OCR 检查后才能更新收款。' },
        technicalReference: 'utility-upload-ocr-required',
        documentId: documentInsert.data.id,
        extraction
      });
    }

    const confirmResponse = await fetch(new URL('/api/utility-bills/confirm', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: request.headers.get('cookie') ?? '' },
      body: JSON.stringify({
        tenancyId,
        rentalCollectionId: rentalCollectionId || undefined,
        documentId: documentInsert.data.id,
        provider: reviewedProvider,
        accountNumber: extraction.accountNumber,
        meterNumber: extraction.meterNumber,
        registeredName: extraction.registeredName,
        billingAddress: extraction.serviceAddress,
        billNumber: extraction.billNumber,
        billDate: normalizeExtractedDate(extraction.billDate),
        dueDate: normalizeExtractedDate(extraction.dueDate),
        totalAmountDue: extraction.totalAmountDue ?? 0,
        extractedJson: extraction,
        confidenceJson: { overall: extraction.confidence },
        rawExtractedText: rawText,
        sourceFilename: file.name,
        createCollectionIfMissing,
        collectionMonth
      })
    });
    const confirmPayload = await confirmResponse.json();
    if (!confirmResponse.ok || !confirmPayload.success) {
      return NextResponse.json({
        ...confirmPayload,
        failedStage: confirmPayload.failedStage ?? 'utility-bill-confirmation',
        affectedRecordIds: [...affectedRecordIds, ...(confirmPayload.affectedRecordIds ?? [])]
      }, { status: confirmResponse.status });
    }

    return NextResponse.json({
      ...confirmPayload,
      affectedRecordIds: [...affectedRecordIds, ...(confirmPayload.affectedRecordIds ?? [])],
      message: { en: 'Utility bill uploaded, extracted and confirmed.', zh: '水电账单已上传、提取并确认。' },
      documentId: documentInsert.data.id,
      extraction
    });
  } catch (error) {
    console.error('Utility bill upload failed');
    return NextResponse.json({
      success: false,
      failedStage: 'server',
      affectedRecordIds,
      rollbackStatus: 'manual-review',
      message: { en: 'Utility bill upload failed.', zh: '水电账单上传失败。' },
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
