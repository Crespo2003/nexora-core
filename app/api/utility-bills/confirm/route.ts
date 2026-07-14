import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const allowedProviders = new Set(['tnb', 'water', 'iwk', 'wifi', 'aircond', 'other']);

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      tenancyId: string;
      rentalCollectionId?: string;
      documentId?: string;
      extractionId?: string;
      provider: string;
      accountNumber: string;
      meterNumber?: string;
      registeredName?: string;
      billingAddress?: string;
      billNumber?: string;
      billMonth?: string;
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

    if (!payload.tenancyId || !allowedProviders.has(payload.provider) || !Number.isFinite(Number(payload.totalAmountDue)) || Number(payload.totalAmountDue) < 0) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds: [],
        rollbackStatus: 'not-required',
        message: { en: 'Tenancy, provider and a valid bill amount are required.', zh: '必须填写租约、供应商和有效账单金额。' },
        technicalReference: 'invalid-utility-bill'
      }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent', 'finance'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    const transaction = await supabase.rpc('sprint_005_confirm_utility_bill', {
      p_workspace_id: workspaceId,
      p_payload: payload
    });
    if (transaction.error) throw transaction.error;
    const result = transaction.data as {
      utilityBill: { id: string };
      utilityAccountId: string | null;
      rentalCollectionId: string | null;
      documentId: string | null;
      extractionId: string | null;
    };
    const affectedRecordIds = [result.utilityBill.id, result.utilityAccountId, result.rentalCollectionId, result.documentId, result.extractionId]
      .filter((value): value is string => Boolean(value));

    return NextResponse.json({
      success: true,
      failedStage: null,
      affectedRecordIds,
      rollbackStatus: 'atomic-transaction',
      message: { en: 'Utility bill confirmed and collection updated.', zh: '水电账单已确认，收款记录已更新。' },
      technicalReference: 'sprint-005-utility-bill-transaction',
      utilityBillId: result.utilityBill.id,
      utilityAccountId: result.utilityAccountId,
      rentalCollectionId: result.rentalCollectionId
    });
  } catch (error) {
    const reference = getApiErrorMessage(error);
    const duplicate = reference.includes('duplicate') || reference.includes('23505');
    return NextResponse.json({
      success: false,
      failedStage: duplicate ? 'duplicate-check' : 'transaction',
      affectedRecordIds: [],
      rollbackStatus: 'rolled-back',
      message: duplicate
        ? { en: 'This utility bill was already imported.', zh: '此水电账单已经导入。' }
        : { en: 'Utility bill confirmation failed. No records were changed.', zh: '水电账单确认失败，未更改任何记录。' },
      technicalReference: reference
    }, { status: duplicate ? 409 : 500 });
  }
}
