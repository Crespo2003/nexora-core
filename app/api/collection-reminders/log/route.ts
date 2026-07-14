import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      rentalCollectionId: string;
      reminderType: string;
      language: 'en' | 'zh' | 'bilingual';
      messageText: string;
      sentStatus: 'draft' | 'copied' | 'sent' | 'cancelled';
      channel?: string;
    };
    if (!payload.rentalCollectionId || !payload.messageText) {
      return NextResponse.json({ success: false, failedStage: 'validation', affectedRecordIds: [], rollbackStatus: 'not-required', message: { en: 'Collection and reminder message are required.', zh: '必须选择收款记录并填写提醒内容。' }, technicalReference: 'invalid-reminder' }, { status: 400 });
    }
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent', 'finance'], request);
    if (auth instanceof Response) return auth;
    const transaction = await auth.supabase.rpc('sprint_005_log_collection_reminder', {
      p_workspace_id: auth.workspaceId,
      p_payload: payload
    });
    if (transaction.error) throw transaction.error;
    const result = transaction.data as { reminder: { id: string } };
    return NextResponse.json({
      success: true, failedStage: null, affectedRecordIds: [result.reminder.id], rollbackStatus: 'atomic-transaction',
      message: { en: 'Reminder logged.', zh: '提醒记录已保存。' }, technicalReference: 'sprint-005-reminder-transaction', reminderId: result.reminder.id
    });
  } catch (error) {
    return NextResponse.json({
      success: false, failedStage: 'transaction', affectedRecordIds: [], rollbackStatus: 'rolled-back',
      message: { en: 'Reminder could not be logged. No records were changed.', zh: '无法保存提醒记录，未更改任何记录。' }, technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
