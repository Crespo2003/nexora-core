import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const actions = new Set(['contacted', 'snoozed', 'promise_to_pay', 'escalated', 'closed']);

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      rentalCollectionId: string;
      action: string;
      snoozedUntil?: string;
      promiseToPayDate?: string;
      notes?: string;
    };
    if (!payload.rentalCollectionId || !actions.has(payload.action)) {
      return NextResponse.json({ success: false, failedStage: 'validation', affectedRecordIds: [], rollbackStatus: 'not-required', message: { en: 'A valid collection and follow-up action are required.', zh: '必须选择有效收款记录和跟进行动。' }, technicalReference: 'invalid-followup-action' }, { status: 400 });
    }
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const transaction = await auth.supabase.rpc('sprint_005_save_collection_followup', {
      p_workspace_id: auth.workspaceId,
      p_payload: payload
    });
    if (transaction.error) throw transaction.error;
    const result = transaction.data as { followup: { id: string } };
    return NextResponse.json({
      success: true, failedStage: null, affectedRecordIds: [result.followup.id], rollbackStatus: 'atomic-transaction',
      message: { en: 'Follow-up action saved.', zh: '跟进行动已保存。' }, technicalReference: 'sprint-005-followup-transaction', followupId: result.followup.id
    });
  } catch (error) {
    return NextResponse.json({
      success: false, failedStage: 'transaction', affectedRecordIds: [], rollbackStatus: 'rolled-back',
      message: { en: 'Follow-up action could not be saved. No records were changed.', zh: '无法保存跟进行动，未更改任何记录。' }, technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
