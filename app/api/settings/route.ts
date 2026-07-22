import { NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '../../../lib/supabase/server';

export async function GET() {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  const { supabase, workspaceId } = auth;

  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, slug, status, logo_url, ren_number, email_from_name, email_from_address, whatsapp_default_number, created_at')
    .eq('id', workspaceId)
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, workspace: data });
}

export async function PATCH(request: Request) {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  const { supabase, workspaceId, role } = auth;

  if (!['owner', 'admin'].includes(role)) {
    return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const allowed = ['name', 'logo_url', 'ren_number', 'email_from_name', 'email_from_address', 'whatsapp_default_number'];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
  }

  const { error } = await supabase.from('workspaces').update(update).eq('id', workspaceId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
