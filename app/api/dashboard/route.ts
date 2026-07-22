import { NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '../../../lib/supabase/server';
import { currentIsoDate, currentIsoMonth } from '../../../lib/dates/formatDate';

export async function GET() {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  const { supabase, workspaceId } = auth;

  const today = currentIsoDate();
  const thisMonth = currentIsoMonth();
  const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const endOfMonth = `${thisMonth}-31`;

  const [
    activeTenanciesResult,
    expiringResult,
    renewalsResult,
    collectionsResult,
    outstandingResult,
    topPropertiesResult,
    activityResult,
    leadsResult,
    followupsResult,
  ] = await Promise.allSettled([
    supabase
      .from('tenancies')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'active'),
    supabase
      .from('tenancies')
      .select('id, tenant, property, unit_no, expiry_date')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .lte('expiry_date', in30Days)
      .gte('expiry_date', today)
      .order('expiry_date', { ascending: true })
      .limit(5),
    supabase
      .from('tenancies')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .gte('expiry_date', `${thisMonth}-01`)
      .lte('expiry_date', endOfMonth),
    supabase
      .from('rental_collections')
      .select('total_due, outstanding_balance, amount_paid')
      .eq('workspace_id', workspaceId)
      .eq('collection_month', thisMonth),
    supabase
      .from('rental_collections')
      .select('outstanding_balance')
      .eq('workspace_id', workspaceId)
      .gt('outstanding_balance', 0),
    supabase
      .from('tenancies')
      .select('property')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active'),
    supabase
      .from('activity_logs')
      .select('id, entity_type, activity_type, activity_json, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('commercial_requirements')
      .select('id, title, status, requirement_type, updated_at')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("completed","lost","cancelled")')
      .order('updated_at', { ascending: false })
      .limit(5),
    supabase
      .from('commercial_requirements')
      .select('id, title, next_follow_up, status')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("completed","lost","cancelled")')
      .lte('next_follow_up', in30Days)
      .gte('next_follow_up', today)
      .order('next_follow_up', { ascending: true })
      .limit(5),
  ]);

  const activeTenancies = activeTenanciesResult.status === 'fulfilled' ? (activeTenanciesResult.value.count ?? 0) : 0;
  const expiringIn30 = expiringResult.status === 'fulfilled' ? (expiringResult.value.data ?? []) : [];
  const renewalsThisMonth = renewalsResult.status === 'fulfilled' ? (renewalsResult.value.count ?? 0) : 0;

  const collections = collectionsResult.status === 'fulfilled' ? (collectionsResult.value.data ?? []) : [];
  const monthlyDue = collections.reduce((s, r) => s + Number(r.total_due ?? 0), 0);
  const monthlyPaid = collections.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0);
  const collectionPct = monthlyDue > 0 ? Math.round((monthlyPaid / monthlyDue) * 100) : 0;

  const outstanding = outstandingResult.status === 'fulfilled' ? (outstandingResult.value.data ?? []) : [];
  const outstandingTotal = outstanding.reduce((s, r) => s + Number(r.outstanding_balance ?? 0), 0);

  const tenanciesForProperties = topPropertiesResult.status === 'fulfilled' ? (topPropertiesResult.value.data ?? []) : [];
  const propertyCountMap: Record<string, number> = {};
  for (const t of tenanciesForProperties) {
    if (t.property) propertyCountMap[t.property] = (propertyCountMap[t.property] ?? 0) + 1;
  }
  const topProperties = Object.entries(propertyCountMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const recentActivities = activityResult.status === 'fulfilled' ? (activityResult.value.data ?? []) : [];
  const leads = leadsResult.status === 'fulfilled' ? (leadsResult.value.data ?? []) : [];
  const upcomingFollowups = followupsResult.status === 'fulfilled' ? (followupsResult.value.data ?? []) : [];

  return NextResponse.json({
    success: true,
    metrics: {
      activeTenancies,
      monthlyDue,
      monthlyPaid,
      collectionPct,
      outstandingTotal,
      renewalsThisMonth,
      expiringIn30Count: expiringIn30.length,
    },
    expiringIn30,
    topProperties,
    recentActivities,
    leads,
    upcomingFollowups,
  });
}
