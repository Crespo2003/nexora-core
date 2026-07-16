import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../lib/supabase/server';

const allowedRoles = ['admin', 'manager', 'agent', 'finance', 'viewer'] as const;

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin'], request);
    if (auth instanceof Response) return auth;
    const payload = await request.json() as { email?: string; role?: string; expiryHours?: number };
    if (!payload.email?.trim() || !allowedRoles.includes(payload.role as typeof allowedRoles[number])) {
      return NextResponse.json({ success: false, error: 'invalid-invitation' }, { status: 400 });
    }
    const result = await auth.supabase.rpc('create_workspace_invitation', {
      target_workspace_id: auth.workspaceId,
      invite_email: payload.email.trim(),
      invite_role: payload.role,
      expiry_hours: payload.expiryHours ?? 72
    });
    if (result.error) throw result.error;
    const invitation = result.data as { invitationId: string; token: string; email: string; role: string; expiresAt: string };
    return NextResponse.json({
      success: true,
      invitation: { ...invitation, acceptPath: `/invitations/accept?invite=${encodeURIComponent(invitation.token)}` }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes('active_invitation_exists') ? 'active-invitation-exists' : message.includes('already_a_workspace_member') ? 'already-a-member' : getApiErrorMessage(error);
    return NextResponse.json({ success: false, error: code }, { status: code === 'request-failed' ? 500 : 400 });
  }
}
