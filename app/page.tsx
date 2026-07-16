import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACTIVE_WORKSPACE_COOKIE, getCurrentUserMemberships } from '../lib/supabase/server';
import RentalCommandCentre from './rental-command-centre';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { user, memberships } = await getCurrentUserMemberships();
  if (!user) redirect('/login');
  const active = memberships.filter((membership) => membership.status === 'active' && membership.workspaces?.status === 'active');
  if (active.length === 0) {
    if (memberships.some((membership) => ['disabled', 'suspended'].includes(membership.status) || membership.workspaces?.status === 'suspended')) redirect('/access-denied?reason=membership-suspended');
    redirect('/onboarding/workspace');
  }
  const selected = cookies().get(ACTIVE_WORKSPACE_COOKIE)?.value;
  if (selected && !active.some((membership) => membership.workspace_id === selected)) redirect('/access-denied?reason=workspace-unauthorized');
  if (active.length > 1 && !active.some((membership) => membership.workspace_id === selected)) redirect('/workspace/select');
  return <RentalCommandCentre />;
}
