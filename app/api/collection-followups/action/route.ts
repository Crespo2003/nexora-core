import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const actionToStatus: Record<string, string> = {
  contacted: 'contacted',
  snoozed: 'snoozed',
  promise_to_pay: 'promise_to_pay',
  escalated: 'escalated',
  closed: 'closed'
};

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      rentalCollectionId: string;
      action: string;
      snoozedUntil?: string;
      promiseToPayDate?: string;
      notes?: string;
    };

    if (!payload.rentalCollectionId || !actionToStatus[payload.action]) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds: [],
        rollbackStatus: 'not-required',
        message: { en: 'A valid collection and follow-up action are required.', zh: '必须选择有效收款记录和跟进行动。' },
        technicalReference: 'invalid-followup-action'
      }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    const existing = await supabase
      .from('collection_followups')
      .select('id')
      .eq('rental_collection_id', payload.rentalCollectionId)
      .maybeSingle();
    if (existing.error) throw existing.error;

    const followupPayload = {
      rental_collection_id: payload.rentalCollectionId,
      workspace_id: workspaceId,
      followup_status: actionToStatus[payload.action],
      recommended_action: payload.action,
      snoozed_until: payload.action === 'snoozed' ? payload.snoozedUntil ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10) : null,
      promise_to_pay_date: payload.action === 'promise_to_pay' ? payload.promiseToPayDate ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10) : null,
      last_contacted_at: payload.action === 'contacted' ? new Date().toISOString() : null,
      notes: payload.notes ?? ''
    };

    const result = existing.data
      ? await supabase.from('collection_followups').update(followupPayload).eq('id', existing.data.id).select('id').single()
      : await supabase.from('collection_followups').insert(followupPayload).select('id').single();

    if (result.error) throw result.error;

    await supabase.from('activity_logs').insert({
      entity_type: 'rental_collection',
      entity_id: payload.rentalCollectionId,
      workspace_id: workspaceId,
      activity_type: `followup_${payload.action}`,
      activity_json: { followupId: result.data.id, action: payload.action }
    });

    return NextResponse.json({
      success: true,
      failedStage: null,
      affectedRecordIds: [result.data.id],
      rollbackStatus: 'not-required',
      message: { en: 'Follow-up action saved.', zh: '跟进行动已保存。' },
      technicalReference: 'sprint-003-followup-action',
      followupId: result.data.id
    });
  } catch (error) {
    console.error('Follow-up action failed');
    return NextResponse.json({
      success: false,
      failedStage: 'server',
      affectedRecordIds: [],
      rollbackStatus: 'manual-review',
      message: { en: 'Follow-up action could not be saved.', zh: '无法保存跟进行动。' },
      technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
