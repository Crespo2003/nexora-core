import { NextResponse } from 'next/server';
import { maskAccountNumber } from '../../../../lib/collections/core';
import { normalizeAccountNumber } from '../../../../lib/collections/live';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const amountFieldByProvider: Record<string, string> = {
  tnb: 'tnb_amount',
  water: 'water_amount',
  iwk: 'iwk_amount',
  wifi: 'wifi_amount',
  aircond: 'aircond_amount',
  other: 'other_charges'
};

export async function POST(request: Request) {
  const affectedRecordIds: string[] = [];

  try {
    const payload = await request.json() as {
      tenancyId: string;
      rentalCollectionId?: string;
      documentId?: string;
      provider: string;
      accountNumber: string;
      meterNumber?: string;
      registeredName?: string;
      billingAddress?: string;
      billNumber?: string;
      billDate?: string;
      dueDate?: string;
      totalAmountDue: number;
      extractedJson?: unknown;
      confidenceJson?: unknown;
      rawExtractedText?: string;
      sourceFilename?: string;
      createCollectionIfMissing?: boolean;
      collectionMonth?: string;
    };

    if (!payload.tenancyId || !payload.provider || !Number.isFinite(Number(payload.totalAmountDue))) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds,
        rollbackStatus: 'not-required',
        message: { en: 'Tenancy, provider and bill amount are required.', zh: '必须填写租约、水电供应商和账单金额。' },
        technicalReference: 'invalid-utility-bill'
      }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent', 'finance'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    if (payload.billNumber) {
      const duplicate = await supabase
        .from('utility_bills')
        .select('id')
        .eq('provider', payload.provider)
        .eq('bill_number', payload.billNumber)
        .maybeSingle();
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data) {
        return NextResponse.json({
          success: false,
          failedStage: 'duplicate-check',
          affectedRecordIds,
          rollbackStatus: 'not-required',
          message: { en: 'This utility bill was already imported.', zh: '此水电账单已经导入。' },
          technicalReference: 'duplicate-utility-bill'
        }, { status: 409 });
      }
    }

    if (!payload.billNumber && payload.accountNumber && payload.totalAmountDue) {
      const practicalDuplicate = await supabase
        .from('utility_bills')
        .select('id, utility_accounts!inner(account_number_normalized)')
        .eq('provider', payload.provider)
        .eq('utility_accounts.account_number_normalized', normalizeAccountNumber(payload.accountNumber))
        .eq('total_amount_due', Number(payload.totalAmountDue))
        .maybeSingle();
      if (practicalDuplicate.error) throw practicalDuplicate.error;
      if (practicalDuplicate.data) {
        return NextResponse.json({
          success: false,
          failedStage: 'duplicate-check',
          affectedRecordIds,
          rollbackStatus: 'not-required',
          message: { en: 'A matching utility bill was already imported.', zh: '相同的水电账单已经导入。' },
          technicalReference: 'duplicate-utility-bill-practical'
        }, { status: 409 });
      }
    }

    let accountId: string | null = null;
    if (payload.accountNumber) {
      const normalized = normalizeAccountNumber(payload.accountNumber);
      const existing = await supabase
        .from('utility_accounts')
        .select('*')
        .eq('provider', payload.provider)
        .eq('account_number_normalized', normalized)
        .maybeSingle();
      if (existing.error) throw existing.error;

      if (existing.data) {
        accountId = existing.data.id;
      } else {
        const accountInsert = await supabase
          .from('utility_accounts')
          .insert({
            tenancy_id: payload.tenancyId,
            workspace_id: workspaceId,
            provider: payload.provider,
            account_number: payload.accountNumber,
            account_number_normalized: normalized,
            account_number_masked: maskAccountNumber(payload.accountNumber),
            meter_number: payload.meterNumber ?? '',
            registered_name: payload.registeredName ?? '',
            billing_address: payload.billingAddress ?? '',
            account_status: 'active'
          })
          .select('id')
          .single();
        if (accountInsert.error) throw accountInsert.error;
        accountId = accountInsert.data.id;
        affectedRecordIds.push(accountId);
      }
    }

    let collectionId = payload.rentalCollectionId ?? null;
    if (!collectionId && payload.createCollectionIfMissing && payload.collectionMonth) {
      const tenancy = await supabase.from('tenancies').select('monthly_rental, rental_due_day').eq('id', payload.tenancyId).single();
      if (tenancy.error) throw tenancy.error;
      const dueDay = String(Math.min(Math.max(Number(tenancy.data.rental_due_day ?? 1), 1), 28)).padStart(2, '0');
      const collectionInsert = await supabase
        .from('rental_collections')
        .insert({
          tenancy_id: payload.tenancyId,
          workspace_id: workspaceId,
          collection_month: `${payload.collectionMonth.slice(0, 7)}-01`,
          due_date: `${payload.collectionMonth.slice(0, 7)}-${dueDay}`,
          rental_amount: Number(tenancy.data.monthly_rental ?? 0),
          payment_status: 'pending'
        })
        .select('id')
        .single();
      if (collectionInsert.error) throw collectionInsert.error;
      collectionId = collectionInsert.data.id;
      affectedRecordIds.push(collectionId);
    }

    const billInsert = await supabase
      .from('utility_bills')
      .insert({
        utility_account_id: accountId,
        workspace_id: workspaceId,
        tenancy_id: payload.tenancyId,
        rental_collection_id: collectionId,
        document_id: payload.documentId || null,
        provider: payload.provider,
        bill_number: payload.billNumber ?? '',
        bill_date: payload.billDate || null,
        due_date: payload.dueDate || null,
        total_amount_due: Number(payload.totalAmountDue),
        extracted_json: payload.extractedJson ?? {},
        confidence_json: payload.confidenceJson ?? {},
        review_status: 'confirmed',
        raw_extracted_text: payload.rawExtractedText ?? '',
        source_filename: payload.sourceFilename ?? ''
      })
      .select('id')
      .single();
    if (billInsert.error) throw billInsert.error;
    affectedRecordIds.push(billInsert.data.id);

    if (collectionId) {
      const field = amountFieldByProvider[payload.provider] ?? 'other_charges';
      const update = await supabase
        .from('rental_collections')
        .update({ [field]: Number(payload.totalAmountDue) })
        .eq('id', collectionId)
        .select('id')
        .single();
      if (update.error) throw update.error;
      affectedRecordIds.push(collectionId);
    }

    await supabase.from('activity_logs').insert({
      entity_type: 'utility_bill',
      entity_id: billInsert.data.id,
      workspace_id: workspaceId,
      activity_type: 'utility_bill_confirmed',
      activity_json: { provider: payload.provider, collectionId, accountId }
    });

    return NextResponse.json({
      success: true,
      failedStage: null,
      affectedRecordIds,
      rollbackStatus: 'not-required',
      message: { en: 'Utility bill confirmed and collection updated.', zh: '水电账单已确认，收款记录已更新。' },
      technicalReference: 'sprint-003-utility-bill-confirm',
      utilityBillId: billInsert.data.id,
      utilityAccountId: accountId,
      rentalCollectionId: collectionId
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      failedStage: 'server',
      affectedRecordIds,
      rollbackStatus: 'manual-review',
      message: { en: 'Utility bill confirmation failed.', zh: '水电账单确认失败。' },
      technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
