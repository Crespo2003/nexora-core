import { NextResponse } from 'next/server';
import { maskAccountNumber } from '../../../lib/collections/core';
import { normalizeAccountNumber } from '../../../lib/collections/live';
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

    if (!providers.includes(payload.provider) || !payload.accountNumber) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds: [],
        rollbackStatus: 'not-required',
        message: { en: 'Provider and account number are required.', zh: '必须填写供应商和账户号码。' },
        technicalReference: 'invalid-utility-account'
      }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    const normalized = normalizeAccountNumber(payload.accountNumber);
    const duplicate = await supabase
      .from('utility_accounts')
      .select('id')
      .eq('provider', payload.provider)
      .eq('account_number_normalized', normalized)
      .maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) {
      return NextResponse.json({
        success: false,
        failedStage: 'duplicate-check',
        affectedRecordIds: [],
        rollbackStatus: 'not-required',
        message: { en: 'This utility account already exists.', zh: '此水电账户已经存在。' },
        technicalReference: 'duplicate-utility-account'
      }, { status: 409 });
    }

    const insert = await supabase.from('utility_accounts').insert({
      tenancy_id: payload.tenancyId || null,
      workspace_id: workspaceId,
      provider: payload.provider,
      account_number: payload.accountNumber,
      account_number_normalized: normalized,
      account_number_masked: maskAccountNumber(payload.accountNumber),
      meter_number: payload.meterNumber ?? '',
      registered_name: payload.registeredName ?? '',
      billing_address: payload.billingAddress ?? '',
      recurring_fee: payload.recurringFee ?? 0,
      notes: payload.notes ?? '',
      account_status: 'active'
    }).select('id').single();
    if (insert.error) throw insert.error;

    await supabase.from('activity_logs').insert({
      entity_type: 'utility_account',
      entity_id: insert.data.id,
      workspace_id: workspaceId,
      activity_type: 'utility_account_created',
      activity_json: { provider: payload.provider }
    });

    return NextResponse.json({
      success: true,
      failedStage: null,
      affectedRecordIds: [insert.data.id],
      rollbackStatus: 'not-required',
      message: { en: 'Utility account created.', zh: '水电账户已创建。' },
      technicalReference: 'sprint-003-utility-account-create',
      utilityAccountId: insert.data.id
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      failedStage: 'server',
      affectedRecordIds: [],
      rollbackStatus: 'manual-review',
      message: { en: 'Utility account could not be saved.', zh: '无法保存水电账户。' },
      technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
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

    if (!payload.id) {
      return NextResponse.json({ success: false, failedStage: 'validation', technicalReference: 'missing-id' }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    const existing = await supabase.from('utility_accounts').select('*').eq('id', payload.id).single();
    if (existing.error) throw existing.error;

    const nextAccountNumber = payload.accountNumber ?? existing.data.account_number;
    const accountChanged = payload.accountNumber && payload.accountNumber !== existing.data.account_number;

    if (accountChanged) {
      await supabase.from('utility_account_history').insert({
        utility_account_id: payload.id,
        workspace_id: workspaceId,
        tenancy_id: existing.data.tenancy_id,
        provider: existing.data.provider,
        previous_account_number: existing.data.account_number,
        previous_account_number_masked: existing.data.account_number_masked,
        changed_to_account_number: payload.accountNumber,
        change_reason: 'manual-account-update'
      });
    }

    const update = await supabase.from('utility_accounts').update({
      account_number: nextAccountNumber,
      account_number_normalized: normalizeAccountNumber(nextAccountNumber),
      account_number_masked: maskAccountNumber(nextAccountNumber),
      account_status: payload.accountStatus ?? (accountChanged ? 'changed' : existing.data.account_status),
      meter_number: payload.meterNumber ?? existing.data.meter_number,
      registered_name: payload.registeredName ?? existing.data.registered_name,
      billing_address: payload.billingAddress ?? existing.data.billing_address,
      notes: payload.notes ?? existing.data.notes
    }).eq('id', payload.id).select('id').single();
    if (update.error) throw update.error;

    await supabase.from('activity_logs').insert({
      entity_type: 'utility_account',
      entity_id: payload.id,
      workspace_id: workspaceId,
      activity_type: accountChanged ? 'utility_account_changed' : 'utility_account_updated',
      activity_json: { accountChanged }
    });

    return NextResponse.json({
      success: true,
      failedStage: null,
      affectedRecordIds: [payload.id],
      rollbackStatus: 'not-required',
      message: { en: 'Utility account updated.', zh: '水电账户已更新。' },
      technicalReference: 'sprint-003-utility-account-update'
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      failedStage: 'server',
      affectedRecordIds: [],
      rollbackStatus: 'manual-review',
      message: { en: 'Utility account update failed.', zh: '水电账户更新失败。' },
      technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
