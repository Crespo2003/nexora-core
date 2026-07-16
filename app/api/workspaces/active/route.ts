import { NextResponse } from 'next/server';
import { ACTIVE_WORKSPACE_COOKIE, getRouteSupabaseClient, requireTrustedOrigin } from '../../../../lib/supabase/server';

export async function POST(request: Request) {
  const originError = requireTrustedOrigin(request);
  if (originError) return originError;
  const { workspaceId } = await request.json() as { workspaceId?: string };
  if (!workspaceId) return NextResponse.json({ success: false, error: 'workspace-required' }, { status: 400 });
  const supabase = getRouteSupabaseClient();
  const user = await supabase.auth.getUser();
  if (user.error || !user.data.user) return NextResponse.json({ success: false, error: 'authentication-required' }, { status: 401 });
  const membership = await supabase.from('workspace_members').select('workspace_id, status').eq('workspace_id', workspaceId).eq('user_id', user.data.user.id).maybeSingle();
  if (membership.error || !membership.data || membership.data.status !== 'active') return NextResponse.json({ success: false, error: 'workspace-access-denied' }, { status: 403 });
  const response = NextResponse.json({ success: true, workspaceId });
  response.cookies.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return response;
}
