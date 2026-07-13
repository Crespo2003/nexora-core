import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const methods = ['bank_transfer', 'cash', 'duitnow', 'touch_n_go', 'cheque', 'online_banking', 'other'];
const transactionTypes = ['payment', 'adjustment', 'waiver', 'refund', 'reversal'];

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

    if (!payload.rentalCollectionId || !Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) {
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
    const insert = await supabase
      .from('collection_payments')
      .insert({
        rental_collection_id: payload.rentalCollectionId,
        workspace_id: workspaceId,
        amount: Number(payload.amount),
        payment_date: payload.paymentDate,
        payment_method: payload.paymentMethod,
        payment_reference: payload.paymentReference ?? '',
        receipt_number: payload.receiptNumber ?? '',
        notes: payload.notes ?? '',
        recorded_by: payload.recordedBy ?? user.email ?? '',
        transaction_type: payload.transactionType ?? 'payment'
      })
      .select('*')
      .single();

    if (insert.error) throw insert.error;

    const payments = await supabase
      .from('collection_payments')
      .select('amount, transaction_type')
      .eq('rental_collection_id', payload.rentalCollectionId);
    if (payments.error) throw payments.error;

    const amountPaid = (payments.data ?? []).reduce((sum, payment) => {
      const amount = Number(payment.amount ?? 0);
      if (payment.transaction_type === 'refund' || payment.transaction_type === 'reversal') return sum - amount;
      if (payment.transaction_type === 'payment') return sum + amount;
      return sum;
    }, 0);

    const collection = await supabase
      .from('rental_collections')
      .select('total_due, due_date')
      .eq('id', payload.rentalCollectionId)
      .single();
    if (collection.error) throw collection.error;

    const totalDue = Number(collection.data.total_due ?? 0);
    const dueDate = String(collection.data.due_date ?? '');
    const today = new Date().toISOString().slice(0, 10);
    const status = amountPaid >= totalDue ? 'paid' : amountPaid > 0 ? 'partial' : dueDate < today ? 'overdue' : 'outstanding';

    const update = await supabase
      .from('rental_collections')
      .update({ amount_paid: amountPaid, payment_status: status, payment_date: payload.paymentDate, payment_method: payload.paymentMethod, payment_reference: payload.paymentReference ?? '' })
      .eq('id', payload.rentalCollectionId)
      .select('id')
      .single();
    if (update.error) throw update.error;

    await supabase.from('activity_logs').insert({
      entity_type: 'rental_collection',
      entity_id: payload.rentalCollectionId,
      workspace_id: workspaceId,
      activity_type: payload.transactionType === 'reversal' ? 'payment_reversed' : 'payment_recorded',
      activity_json: { paymentId: insert.data.id, amount: payload.amount, transactionType: payload.transactionType ?? 'payment' }
    });

    return NextResponse.json({
      success: true,
      failedStage: null,
      affectedRecordIds: [insert.data.id, payload.rentalCollectionId],
      rollbackStatus: 'not-required',
      message: { en: 'Payment ledger updated and collection recalculated.', zh: '付款流水已更新，收款记录已重新计算。' },
      technicalReference: 'sprint-003-payment-ledger',
      payment: insert.data,
      amountPaid,
      status
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      failedStage: 'server',
      affectedRecordIds: [],
      rollbackStatus: 'manual-review',
      message: { en: 'Payment could not be recorded.', zh: '无法记录付款。' },
      technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
