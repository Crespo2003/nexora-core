import { NextResponse } from 'next/server';
import { generateMonthlyCollections } from '../../../../lib/collections/core';
import type { SmartCollection, TenancySummary } from '../../../../lib/collections/types';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

function cleanNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function tenancyFromRow(row: Record<string, unknown>): TenancySummary {
  return {
    id: String(row.id),
    tenant: String(row.tenant ?? ''),
    tenantPhone: String(row.tenant_phone ?? ''),
    preferredLanguage: String(row.preferred_language ?? 'en') as TenancySummary['preferredLanguage'],
    landlord: String(row.landlord ?? ''),
    landlordPhone: String(row.landlord_phone ?? ''),
    assignedAgent: String(row.assigned_agent ?? ''),
    property: String(row.property ?? ''),
    unitNo: String(row.unit_no ?? ''),
    monthlyRental: cleanNumber(row.monthly_rental),
    expiryDate: String(row.expiry_date ?? ''),
    status: String(row.status ?? 'active'),
    rentalDueDay: cleanNumber(row.rental_due_day || 1),
    gracePeriodDays: cleanNumber(row.grace_period_days),
    autoGenerateCollections: Boolean(row.auto_generate_collections),
    collectionStartMonth: String(row.collection_start_month ?? '').slice(0, 7),
    collectionEndMonth: String(row.collection_end_month ?? '').slice(0, 7)
  };
}

function collectionFromRow(row: Record<string, unknown>): SmartCollection {
  return {
    id: String(row.id),
    tenancyId: String(row.tenancy_id ?? ''),
    collectionMonth: String(row.collection_month ?? '').slice(0, 7),
    dueDate: String(row.due_date ?? ''),
    rentalAmount: cleanNumber(row.rental_amount),
    tnbAmount: cleanNumber(row.tnb_amount),
    waterAmount: cleanNumber(row.water_amount),
    iwkAmount: cleanNumber(row.iwk_amount),
    wifiAmount: cleanNumber(row.wifi_amount),
    aircondAmount: cleanNumber(row.aircond_amount),
    otherCharges: cleanNumber(row.other_charges),
    lateCharges: cleanNumber(row.late_charges),
    adjustments: cleanNumber(row.adjustments),
    status: String(row.payment_status ?? 'outstanding') as SmartCollection['status'],
    notes: String(row.notes ?? ''),
    reminderCount: 0,
    paymentLedger: [],
    utilityBillIds: []
  };
}

function recurringUtilityCharges(accounts: Array<Record<string, unknown>>, tenancyId: string) {
  type RecurringCharges = {
    tnb_amount: number;
    water_amount: number;
    iwk_amount: number;
    wifi_amount: number;
    aircond_amount: number;
    other_charges: number;
  };

  const initialCharges: RecurringCharges = {
    tnb_amount: 0,
    water_amount: 0,
    iwk_amount: 0,
    wifi_amount: 0,
    aircond_amount: 0,
    other_charges: 0
  };

  return accounts
    .filter((account) => String(account.tenancy_id ?? '') === tenancyId && String(account.account_status ?? 'active') === 'active')
    .reduce<RecurringCharges>((charges, account) => {
      const provider = String(account.provider ?? 'other');
      const amount = cleanNumber(account.recurring_fee);
      if (amount <= 0) return charges;
      if (provider === 'tnb') charges.tnb_amount += amount;
      else if (provider === 'water') charges.water_amount += amount;
      else if (provider === 'iwk') charges.iwk_amount += amount;
      else if (provider === 'wifi') charges.wifi_amount += amount;
      else if (provider === 'aircond') charges.aircond_amount += amount;
      else charges.other_charges += amount;
      return charges;
    }, initialCharges);
}

export async function POST(request: Request) {
  const affectedRecordIds: string[] = [];

  try {
    const { collectionMonth } = await request.json() as { collectionMonth: string };
    const targetMonth = collectionMonth?.slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds,
        rollbackStatus: 'not-required',
        message: { en: 'Collection month must use YYYY-MM.', zh: '收款月份必须使用 YYYY-MM。' },
        technicalReference: 'invalid-collection-month'
      }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'finance'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    const [
      { data: tenancyRows, error: tenancyError },
      { data: collectionRows, error: collectionError },
      { data: utilityAccountRows, error: utilityAccountError }
    ] = await Promise.all([
      supabase.from('tenancies').select('*').eq('status', 'active'),
      supabase.from('rental_collections').select('*').gte('collection_month', `${targetMonth}-01`).lte('collection_month', `${targetMonth}-28`),
      supabase.from('utility_accounts').select('tenancy_id, provider, recurring_fee, account_status').eq('account_status', 'active')
    ]);

    if (tenancyError) throw tenancyError;
    if (collectionError) throw collectionError;
    if (utilityAccountError) throw utilityAccountError;

    const tenancies = (tenancyRows ?? []).map((row) => tenancyFromRow(row as Record<string, unknown>));
    const existing = (collectionRows ?? []).map((row) => collectionFromRow(row as Record<string, unknown>));
    const plan = generateMonthlyCollections(tenancies, existing, targetMonth, new Date().toISOString().slice(0, 10));
    const created = [];

    for (const item of plan.created) {
      const tenancy = tenancies.find((candidate) => candidate.id === item.tenancyId);
      if (!tenancy) continue;

      const dueDay = String(Math.min(Math.max(tenancy.rentalDueDay, 1), 28)).padStart(2, '0');
      const dueDate = `${targetMonth}-${dueDay}`;
      const utilityCharges = recurringUtilityCharges((utilityAccountRows ?? []) as Array<Record<string, unknown>>, tenancy.id);
      const insert = await supabase
        .from('rental_collections')
        .insert({
          tenancy_id: tenancy.id,
          workspace_id: workspaceId,
          collection_month: `${targetMonth}-01`,
          due_date: dueDate,
          rental_amount: tenancy.monthlyRental,
          ...utilityCharges,
          payment_status: dueDate < new Date().toISOString().slice(0, 10) ? 'overdue' : 'pending',
          notes: 'Generated by Sprint 003 monthly workflow.'
        })
        .select('id')
        .single();

      if (insert.error) {
        plan.failed.push({ tenancyId: tenancy.id, reason: insert.error.message });
        plan.success = false;
      } else {
        affectedRecordIds.push(insert.data.id);
        created.push({ tenancyId: tenancy.id, collectionId: insert.data.id });
        await supabase.from('activity_logs').insert({
          entity_type: 'rental_collection',
          entity_id: insert.data.id,
          activity_type: 'collection_generated',
          workspace_id: workspaceId,
          activity_json: { tenancyId: tenancy.id, collectionMonth: targetMonth }
        });
      }
    }

    return NextResponse.json({
      success: plan.failed.length === 0,
      failedStage: plan.failed.length ? 'record-generation' : null,
      affectedRecordIds,
      rollbackStatus: 'not-required',
      message: {
        en: `${created.length} collection record(s) created. ${plan.skipped.length} skipped.`,
        zh: `已创建 ${created.length} 个收款记录。已跳过 ${plan.skipped.length} 个。`
      },
      technicalReference: 'sprint-003-generate-monthly',
      result: { ...plan, created }
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      failedStage: 'server',
      affectedRecordIds,
      rollbackStatus: 'manual-review',
      message: { en: 'Monthly generation failed.', zh: '月度收款生成失败。' },
      technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
