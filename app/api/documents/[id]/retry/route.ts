import { NextResponse } from 'next/server';
import { extractTenancyDetails } from '../../../../../lib/ai/tenancyExtractor';
import { extractUtilityBill } from '../../../../../lib/collections/core';
import { extractDocumentText } from '../../../../../lib/documents/extractText';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../../lib/supabase/server';

const maxAttempts = 3;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let supabase: any;
  let workspaceId = '';
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent', 'finance'], request);
    if (auth instanceof Response) return auth;
    ({ supabase, workspaceId } = auth);
    const document = await supabase.from('documents').select('*')
      .eq('id', params.id).eq('workspace_id', workspaceId).maybeSingle();
    if (document.error) throw document.error;
    if (!document.data) return workflowError(404, 'document-match', 'Document was not found in this workspace.', '此工作区中找不到该文件。', 'retry-document-not-found');

    const attempts = Number(document.data.processing_attempts ?? 0);
    if (attempts >= maxAttempts) return workflowError(409, 'retry-limit', 'OCR retry limit reached. Review the document manually.', 'OCR 重试次数已达上限，请手动检查文件。', 'ocr-retry-limit');
    if (document.data.processing_status === 'extracting') return workflowError(409, 'processing', 'Document processing is already running.', '文件正在处理中。', 'ocr-already-processing');

    const start = await supabase.from('documents').update({
      processing_status: 'extracting', processing_attempts: attempts + 1,
      processing_started_at: new Date().toISOString(), last_processing_error: ''
    }).eq('id', params.id).eq('workspace_id', workspaceId).select('id').single();
    if (start.error) throw start.error;

    const download = await supabase.storage.from(document.data.storage_bucket).download(document.data.storage_path);
    if (download.error) throw download.error;
    const buffer = Buffer.from(await download.data.arrayBuffer());
    const textResult = await extractDocumentText({ buffer, mimeType: document.data.mime_type, filename: document.data.original_filename });
    const success = textResult.status === 'completed' && Boolean(textResult.text.trim());
    const extractedJson = document.data.document_type === 'tenancy_agreement' && success
      ? extractTenancyDetails(textResult.text, document.data.original_filename, document.data.mime_type)
      : document.data.document_type === 'utility_bill' && success
        ? extractUtilityBill(textResult.text, document.data.original_filename)
        : {};
    const confidenceJson = document.data.document_type === 'utility_bill'
      ? { overall: (extractedJson as { confidence?: string }).confidence ?? 'not_detected' }
      : extractedJson;
    const extraction = await supabase.from('document_extractions').select('id')
      .eq('document_id', params.id).eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (extraction.error) throw extraction.error;
    const extractionValues = {
      raw_text: textResult.text,
      extracted_json: extractedJson,
      confidence_json: confidenceJson,
      ai_summary: success ? 'Retry completed. Review and confirm the extracted values.' : 'Retry failed. Manual review is required.',
      extraction_status: success ? 'pending_review' : 'extraction_failed',
      extraction_error: textResult.error || null,
      completed_at: new Date().toISOString()
    };
    const extractionWrite = extraction.data
      ? await supabase.from('document_extractions').update(extractionValues).eq('id', extraction.data.id).eq('workspace_id', workspaceId).select('id').single()
      : await supabase.from('document_extractions').insert({ document_id: params.id, workspace_id: workspaceId, extraction_version: 'retry-v1', ...extractionValues }).select('id').single();
    if (extractionWrite.error) throw extractionWrite.error;

    const finish = await supabase.from('documents').update({
      processing_status: success ? 'pending_review' : 'extraction_failed',
      last_processing_error: textResult.error
    }).eq('id', params.id).eq('workspace_id', workspaceId).select('id').single();
    if (finish.error) throw finish.error;
    const activity = await supabase.from('activity_logs').insert({
      entity_type: 'document', entity_id: params.id, workspace_id: workspaceId,
      activity_type: success ? 'extraction_retry_completed' : 'extraction_retry_failed',
      activity_json: { attempt: attempts + 1 }
    });
    if (activity.error) throw activity.error;

    if (!success) return NextResponse.json({
      success: false, failedStage: 'ocr', affectedRecordIds: [params.id, extractionWrite.data.id], rollbackStatus: 'document-preserved',
      message: { en: 'OCR retry failed. The document and review record were preserved.', zh: 'OCR 重试失败。文件和检查记录已保留。' },
      technicalReference: textResult.error || 'ocr-retry-failed', retryAllowed: attempts + 1 < maxAttempts
    }, { status: 422 });
    return NextResponse.json({
      success: true, failedStage: null, affectedRecordIds: [params.id, extractionWrite.data.id], rollbackStatus: 'not-required',
      message: { en: 'OCR retry completed. Review and confirm the values.', zh: 'OCR 重试已完成。请检查并确认资料。' },
      technicalReference: 'ocr-retry-review-required', requiresConfirmation: true
    });
  } catch (error) {
    if (supabase && workspaceId) await supabase.from('documents').update({ processing_status: 'extraction_failed', last_processing_error: 'retry-interrupted' }).eq('id', params.id).eq('workspace_id', workspaceId);
    return workflowError(500, 'retry', 'OCR retry could not be completed.', '无法完成 OCR 重试。', getApiErrorMessage(error));
  }
}

function workflowError(status: number, failedStage: string, en: string, zh: string, technicalReference: string) {
  return NextResponse.json({ success: false, failedStage, affectedRecordIds: [], rollbackStatus: 'not-required', message: { en, zh }, technicalReference }, { status });
}
