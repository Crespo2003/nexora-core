import { NextResponse } from 'next/server';
import { ACTIVE_WORKSPACE_COOKIE, getApiErrorMessage, getRouteSupabaseClient, requireTrustedOrigin } from '../../../../lib/supabase/server';

export async function POST(request: Request) {
  try {
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    const { token } = await request.json() as { token?: string };
    if (!token || token.length < 32 || token.length > 256) return NextResponse.json({ success: false, error: 'invitation-invalid' }, { status: 400 });
    const supabase = getRouteSupabaseClient();
    const user = await supabase.auth.getUser();
    if (user.error || !user.data.user) return NextResponse.json({ success: false, error: 'authentication-required' }, { status: 401 });
    if (!user.data.user.email_confirmed_at) return NextResponse.json({ success: false, error: 'verified-email-required' }, { status: 403 });
    const accepted = await supabase.rpc('accept_workspace_invitation', { invitation_token: token });
    if (accepted.error) throw accepted.error;
    const result = accepted.data as { workspaceId: string; role: string };
    const response = NextResponse.json({ success: true, workspaceId: result.workspaceId, role: result.role });
    response.cookies.set(ACTIVE_WORKSPACE_COOKIE, result.workspaceId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes('invitation_email_mismatch') ? 'invitation-email-mismatch' : message.includes('invitation_expired') ? 'invitation-expired' : message.includes('invitation_invalid') ? 'invitation-invalid' : getApiErrorMessage(error);
    return NextResponse.json({ success: false, error: code }, { status: code === 'invitation-email-mismatch' ? 403 : 400 });
  }
}
