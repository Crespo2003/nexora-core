import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NavPage } from '../rbac/permissions';
import { canAccess } from '../rbac/permissions';
import { ACTIVE_WORKSPACE_COOKIE, getCurrentUserMemberships } from '../supabase/server';

export async function requirePortalPageAccess(page: NavPage) {
  const { user, memberships } = await getCurrentUserMemberships();
  if (!user) redirect(`/login?next=${encodeURIComponent(page === 'home' ? '/home' : `/${page}`)}`);

  const active = memberships.filter((membership) => membership.status === 'active' && membership.workspaces?.status === 'active');
  if (active.length === 0) {
    if (memberships.some((membership) => ['disabled', 'suspended'].includes(membership.status) || membership.workspaces?.status === 'suspended')) {
      redirect('/access-denied?reason=membership-suspended');
    }
    redirect('/onboarding/workspace');
  }

  const selected = cookies().get(ACTIVE_WORKSPACE_COOKIE)?.value;
  if (selected && !active.some((membership) => membership.workspace_id === selected)) redirect('/access-denied?reason=workspace-unauthorized');
  if (active.length > 1 && !active.some((membership) => membership.workspace_id === selected)) redirect('/workspace/select');

  const membership = active.find((item) => item.workspace_id === selected) ?? active[0];
  if (!canAccess(membership.role, page)) redirect('/access-denied?reason=permission-denied');
  return membership;
}
