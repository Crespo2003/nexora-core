import { NextRequest, NextResponse } from 'next/server';
import { destinationForMemberships } from '../../../lib/auth/navigation';
import { ACTIVE_WORKSPACE_COOKIE, getCurrentUserMemberships } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { user, memberships } = await getCurrentUserMemberships();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  const destination = destinationForMemberships(memberships, request.nextUrl.searchParams.get('next'));
  const response = NextResponse.redirect(new URL(destination, request.url));
  const active = memberships.filter((membership) => membership.status === 'active');
  if (active.length === 1) response.cookies.set(ACTIVE_WORKSPACE_COOKIE, active[0].workspace_id, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30
  });
  return response;
}
