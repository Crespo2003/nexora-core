import { NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '../../../lib/supabase/server';

export async function GET(request: Request) {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  const { supabase, workspaceId } = auth;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '25'), 100);
  const entityType = url.searchParams.get('entityType') ?? '';
  const entityId = url.searchParams.get('entityId') ?? '';

  let query = supabase
    .from('activity_logs')
    .select('id, entity_type, entity_id, activity_type, activity_json, created_by, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (entityType) query = query.eq('entity_type', entityType);
  if (entityId) query = query.eq('entity_id', entityId);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, rows: rows ?? [] });
}
