import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../lib/supabase/server';

const providers = ['tnb', 'water', 'iwk', 'wifi', 'aircond', 'other'];

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      tenancyId?: string;
      provider: string;
      accountNumber: string;
      meterNumber?: string;
      registeredName?: string;
      billingAddress?: string;
      recurringFee?: number;
      notes?: string;
    };
    if (!providers.includes(payload.provider) || !payload.accountNumber || Number(payload.recurringFee ?? 0) < 0) {
      return failure('validation', 'invalid-utility-account', 'Provider, account number and a non-negative fee are required.', '必须填写供应商、账户号码和非负费用。', 400, 'not-required');
    }
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const transaction = await auth.supabase.rpc('sprint_005_upsert_utility_account', {
      p_workspace_id: auth.workspaceId,
      p_payload: payload
    });
    if (transaction.error) throw transaction.error;
    const result = transaction.data as { utilityAccount: { id: string } };
    return NextResponse.json({
      success: true, failedStage: null, affectedRecordIds: [result.utilityAccount.id], rollbackStatus: 'atomic-transaction',
      message: { en: 'Utility account created.', zh: '水电账户已创建。' }, technicalReference: 'sprint-005-utility-account-transaction',
      utilityAccountId: result.utilityAccount.id
    });
  } catch (error) {
    const reference = getApiErrorMessage(error);
    const duplicate = reference.includes('23505') || reference.includes('duplicate');
    return failure(duplicate ? 'duplicate-check' : 'transaction', reference, duplicate ? 'This utility account already exists.' : 'Utility account could not be saved.', duplicate ? '此水电账户已经存在。' : '无法保存水电账户。', duplicate ? 409 : 500, 'rolled-back');
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as {
      id: string;
      accountNumber?: string;
      accountStatus?: 'active' | 'inactive' | 'changed' | 'closed';
      meterNumber?: string;
      registeredName?: string;
      billingAddress?: string;
      notes?: string;
    };
    if (!payload.id) return failure('validation', 'missing-id', 'Utility account ID is required.', '必须提供水电账户编号。', 400, 'not-required');
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const transaction = await auth.supabase.rpc('sprint_005_upsert_utility_account', {
      p_workspace_id: auth.workspaceId,
      p_payload: payload
    });
    if (transaction.error) throw transaction.error;
    return NextResponse.json({
      success: true, failedStage: null, affectedRecordIds: [payload.id], rollbackStatus: 'atomic-transaction',
      message: { en: 'Utility account updated.', zh: '水电账户已更新。' }, technicalReference: 'sprint-005-utility-account-transaction'
    });
  } catch (error) {
    return failure('transaction', getApiErrorMessage(error), 'Utility account update failed. No records were changed.', '水电账户更新失败，未更改任何记录。', 500, 'rolled-back');
  }
}

function failure(stage: string, reference: string, en: string, zh: string, status: number, rollbackStatus: string) {
  return NextResponse.json({ success: false, failedStage: stage, affectedRecordIds: [], rollbackStatus, message: { en, zh }, technicalReference: reference }, { status });
}
