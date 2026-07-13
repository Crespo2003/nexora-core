import { NextResponse } from 'next/server';
import { buildCollectionOverview } from '../../../../lib/collections/live';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

function monthBounds(month: string) {
  const start = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const end = new Date(year, monthNumber, 0).toISOString().slice(0, 10);
  return { start, end };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const month = (url.searchParams.get('month') || new Date().toISOString().slice(0, 7)).slice(0, 7);
    const language = url.searchParams.get('language') === 'zh' ? 'zh' : 'en';
    const todayIso = new Date().toISOString().slice(0, 10);

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ success: false, error: 'invalid-month', message: { en: 'Invalid collection month.', zh: '收款月份无效。' } }, { status: 400 });
    }

    const { start, end } = monthBounds(month);
    const auth = await requireWorkspaceAccess();
    if (auth instanceof Response) return auth;
    const { supabase } = auth;
    const [tenancies, collections, payments, utilityAccounts, utilityBills, reminders, followups] = await Promise.all([
      supabase.from('tenancies').select('*').order('property'),
      supabase.from('rental_collections').select('*').gte('collection_month', start).lte('collection_month', end).order('due_date'),
      supabase.from('collection_payments').select('*').order('payment_date', { ascending: false }),
      supabase.from('utility_accounts').select('*').order('provider'),
      supabase.from('utility_bills').select('*').order('created_at', { ascending: false }),
      supabase.from('collection_reminders').select('*').order('created_at', { ascending: false }),
      supabase.from('collection_followups').select('*').order('created_at', { ascending: false })
    ]);

    const firstError = [tenancies, collections, payments, utilityAccounts, utilityBills, reminders, followups].find((result) => result.error)?.error;
    if (firstError) throw firstError;

    const overview = buildCollectionOverview({
      tenancies: tenancies.data ?? [],
      collections: collections.data ?? [],
      payments: payments.data ?? [],
      utilityAccounts: utilityAccounts.data ?? [],
      utilityBills: utilityBills.data ?? [],
      reminders: reminders.data ?? [],
      followups: followups.data ?? [],
      month,
      todayIso,
      language
    });

    return NextResponse.json({
      success: true,
      month,
      todayIso,
      overview
    });
  } catch (error) {
    console.error('Collection overview load failed');
    return NextResponse.json({
      success: false,
      error: getApiErrorMessage(error),
      message: {
        en: 'Unable to load live collection data.',
        zh: '无法加载实时收款资料。'
      }
    }, { status: 500 });
  }
}
