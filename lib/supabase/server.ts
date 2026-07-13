import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function getRouteSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase server configuration is missing.');
  }

  const cookieStore = cookies();
  return createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options) {
        cookieStore.set({ name, value: '', ...options });
      }
    }
  });
}

export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'agent' | 'finance' | 'viewer';

export type AuthContext = {
  supabase: ReturnType<typeof getRouteSupabaseClient>;
  user: { id: string; email?: string };
  workspaceId: string;
  role: WorkspaceRole;
};

export function jsonAuthError(status: 401 | 403 | 404, code: string) {
  return Response.json(
    { success: false, error: code },
    { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
  );
}

export function requireTrustedOrigin(request: Request): Response | null {
  const fetchSite = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  const requestOrigin = new URL(request.url).origin;

  if (fetchSite === 'cross-site' || (origin && fetchSite !== 'same-origin' && origin !== requestOrigin)) {
    return jsonAuthError(403, 'cross-site-request-blocked');
  }

  return null;
}

export function rejectOversizedRequest(request: Request, maxBytes: number): Response | null {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return Response.json(
      { success: false, error: 'request-too-large' },
      { status: 413, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
    );
  }
  return null;
}

export async function requireWorkspaceAccess(
  allowedRoles: WorkspaceRole[] = ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  request?: Request
): Promise<AuthContext | Response> {
  if (request) {
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
  }

  const supabase = getRouteSupabaseClient();
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  const user = userResult.user;

  if (userError || !user) return jsonAuthError(401, 'authentication-required');

  const membership = await supabase
    .from('workspace_members')
    .select('workspace_id, role, status')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membership.error) throw membership.error;
  if (!membership.data) return jsonAuthError(403, 'workspace-required');
  if (!allowedRoles.includes(membership.data.role as WorkspaceRole)) return jsonAuthError(403, 'permission-denied');

  return {
    supabase,
    user: { id: user.id, email: user.email ?? undefined },
    workspaceId: String(membership.data.workspace_id),
    role: membership.data.role as WorkspaceRole
  };
}

export function getApiErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String(error.message)
        : '';

  if (message.includes('Supabase server configuration is missing')) return 'database-unavailable';
  if (message.includes('relation') && message.includes('does not exist')) return 'tables-missing';
  if (message.includes('duplicate key') || message.includes('unique constraint')) return 'duplicate-record';
  if (message.includes('row-level security') || message.includes('permission denied')) return 'permission-denied';
  if (message.includes('JWT') || message.includes('session')) return 'authentication-expired';
  return 'request-failed';
}
