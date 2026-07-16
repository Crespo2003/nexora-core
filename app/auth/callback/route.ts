import { NextRequest, NextResponse } from 'next/server';
import { destinationForMemberships, getSafeNextPath } from '../../../lib/auth/navigation';
import { ACTIVE_WORKSPACE_COOKIE, getCurrentUserMemberships, getRouteSupabaseClient } from '../../../lib/supabase/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = getSafeNextPath(request.nextUrl.searchParams.get('next'));
  const failure = new URL('/login', request.url);
  failure.searchParams.set('error', 'verification-failed');
  if (!code) return NextResponse.redirect(failure);

  const supabase = getRouteSupabaseClient();
  const exchange = await supabase.auth.exchangeCodeForSession(code);
  if (exchange.error || !exchange.data.user?.email_confirmed_at) return NextResponse.redirect(failure);
  const { memberships } = await getCurrentUserMemberships(supabase);
  const destination = destinationForMemberships(memberships, next);
  const response = NextResponse.redirect(new URL(destination, request.url));
  const active = memberships.filter((membership) => membership.status === 'active');
  if (active.length === 1) response.cookies.set(ACTIVE_WORKSPACE_COOKIE, active[0].workspace_id, cookieOptions());
  return response;
}

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 };
}
