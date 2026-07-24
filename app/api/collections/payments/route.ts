import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';
import { normalizeDateForStorage } from '../../../../lib/dates/formatDate';
import { writeActivity } from '../../../../lib/activity/log';

const methods = ['bank_transfer', 'cash', 'duitnow', 'touch_n_go', 'cheque', 'online_banking', 'other'];
const transactionTypes = ['payment', 'advance_payment', 'adjustment', 'waiver', 'refund', 'reversal'];

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      rentalCollectionId: string;
      amount: number;
      paymentDate: string;
      paymentMethod: string;
      paymentReference?: string;
      receiptNumber?: string;
      notes?: string;
      recordedBy?: string;
      transactionType?: string;
    };

    const paymentDate = normalizeDateForStorage(payload.paymentDate);
    if (!payload.rentalCollectionId || !paymentDate || !Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds: [],
        rollbackStatus: 'not-required',
        message: { en: 'A positive payment amount and collection ID are required.', zh: '必须填写有效收款记录和正数付款金额。' },
        technicalReference: 'invalid-payment'
      }, { status: 400 });
    }

    if (!methods.includes(payload.paymentMethod) || !transactionTypes.includes(payload.transactionType ?? 'payment')) {
      return NextResponse.json({
        success: false,
        failedStage: 'validation',
        affectedRecordIds: [],
        rollbackStatus: 'not-required',
        message: { en: 'Unsupported payment method or transaction type.', zh: '不支持的付款方式或交易类型。' },
        technicalReference: 'invalid-payment-enum'
      }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'finance'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId, user } = auth;
    const transaction = await supabase.rpc('sprint_005_record_collection_transaction', {
      p_workspace_id: workspaceId,
      p_payload: { ...payload, paymentDate, recordedBy: payload.recordedBy ?? user.email ?? '' }
    });
    if (transaction.error) throw transaction.error;
    const result = transaction.data as {
      payment: { id: string };
      amountPaid: number;
      outstanding: number;
      credit: number;
      status: string;
    };

    void writeActivity(supabase, workspaceId, 'collection', payload.rentalCollectionId, 'payment_recorded', { amount: payload.amount, method: payload.paymentMethod }, user.id);

    return NextResponse.json({
      success: true,
      failedStage: null,
      affectedRecordIds: [result.payment.id, payload.rentalCollectionId],
      rollbackStatus: 'atomic-transaction',
      message: { en: 'Payment ledger updated and collection recalculated.', zh: '付款流水已更新，收款记录已重新计算。' },
      technicalReference: 'sprint-003-payment-ledger',
      payment: result.payment,
      amountPaid: result.amountPaid,
      outstanding: result.outstanding,
      credit: result.credit,
      status: result.status
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      failedStage: 'server',
      affectedRecordIds: [],
      rollbackStatus: 'rolled-back',
      message: { en: 'Payment could not be recorded.', zh: '无法记录付款。' },
      technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
