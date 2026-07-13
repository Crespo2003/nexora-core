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
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds: [],
        rollbackStatus: 'not-required',
        message: { en: 'Collection and reminder message are required.', zh: '必须选择收款记录并填写提醒内容。' },
        technicalReference: 'invalid-reminder'
      }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent', 'finance'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    const insert = await supabase
      .from('collection_reminders')
      .insert({
        rental_collection_id: payload.rentalCollectionId,
        workspace_id: workspaceId,
        reminder_type: payload.reminderType,
        language: payload.language,
        message_text: payload.messageText,
        sent_status: payload.sentStatus,
        sent_at: payload.sentStatus === 'sent' ? new Date().toISOString() : null,
        channel: payload.channel ?? 'whatsapp'
      })
      .select('id')
      .single();

    if (insert.error) throw insert.error;

    await supabase.from('activity_logs').insert({
      entity_type: 'rental_collection',
      entity_id: payload.rentalCollectionId,
      workspace_id: workspaceId,
      activity_type: payload.sentStatus === 'sent' ? 'reminder_marked_sent' : 'reminder_generated',
      activity_json: { reminderId: insert.data.id, reminderType: payload.reminderType, language: payload.language }
    });

    return NextResponse.json({
      success: true,
      failedStage: null,
      affectedRecordIds: [insert.data.id],
      rollbackStatus: 'not-required',
      message: { en: 'Reminder logged.', zh: '提醒记录已保存。' },
      technicalReference: 'sprint-003-reminder-log',
      reminderId: insert.data.id
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      failedStage: 'server',
      affectedRecordIds: [],
      rollbackStatus: 'manual-review',
      message: { en: 'Reminder could not be logged.', zh: '无法保存提醒记录。' },
      technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
