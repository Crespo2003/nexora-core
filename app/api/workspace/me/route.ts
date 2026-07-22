import { NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  return NextResponse.json({
    success: true,
    role: auth.role,
    workspaceId: auth.workspaceId,
    userId: auth.user.id,
  });
}
