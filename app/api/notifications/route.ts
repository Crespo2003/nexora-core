import { NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  const { supabase, workspaceId } = auth;

  const today = new Date().toISOString().slice(0, 10);
  const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const in60Days = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

  const [tenancyResult, collectionResult, activityResult] = await Promise.all([
    supabase
      .from('tenancies')
      .select('id, tenant, property, unit_no, expiry_date, status')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .lte('expiry_date', in60Days)
      .gte('expiry_date', today)
      .order('expiry_date', { ascending: true })
      .limit(20),
    supabase
      .from('rental_collections')
      .select('id, tenancy_id, outstanding_balance, due_date')
      .eq('workspace_id', workspaceId)
      .gt('outstanding_balance', 0)
      .lt('due_date', today)
      .order('due_date', { ascending: true })
      .limit(20),
    supabase
      .from('activity_logs')
      .select('id, entity_type, activity_type, activity_json, created_at')
      .eq('workspace_id', workspaceId)
      .eq('activity_type', 'document_uploaded')
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const notifications: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
  }> = [];

  (tenancyResult.data ?? []).forEach((t) => {
    const daysLeft = Math.ceil(
      (new Date(t.expiry_date).getTime() - new Date(today).getTime()) / 86_400_000
    );
    const urgent = daysLeft <= 30;
    notifications.push({
      id: `renewal-${t.id}`,
      type: 'renewal',
      title: urgent
        ? `Renewal urgent — ${t.tenant}`
        : `Renewal in ${daysLeft} days — ${t.tenant}`,
      body: `${t.property}${t.unit_no ? ' ' + t.unit_no : ''} expires ${t.expiry_date}`,
      entity_type: 'tenancy',
      entity_id: t.id,
      created_at: t.expiry_date,
    });
  });

  (collectionResult.data ?? []).forEach((c) => {
    notifications.push({
      id: `outstanding-${c.id}`,
      type: 'outstanding',
      title: `Outstanding rental overdue`,
      body: `RM ${Number(c.outstanding_balance).toFixed(2)} due ${c.due_date}`,
      entity_type: 'collection',
      entity_id: c.id,
      created_at: c.due_date,
    });
  });

  (activityResult.data ?? []).forEach((a) => {
    const json = (a.activity_json ?? {}) as Record<string, unknown>;
    notifications.push({
      id: `doc-${a.id}`,
      type: 'document_upload',
      title: 'Document uploaded',
      body: String(json.filename ?? 'New document'),
      entity_type: a.entity_type,
      entity_id: String(a.entity_type),
      created_at: a.created_at,
    });
  });

  notifications.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({
    success: true,
    notifications: notifications.slice(0, 30),
    unreadCount: notifications.length,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  const { supabase, workspaceId } = auth;

  const body = await request.json() as { ids?: string[] };
  if (!body.ids?.length) {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('workspace_id', workspaceId)
      .eq('is_read', false);
  } else {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('workspace_id', workspaceId)
      .in('id', body.ids);
  }

  return NextResponse.json({ success: true });
}
