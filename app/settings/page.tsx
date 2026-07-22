import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACTIVE_WORKSPACE_COOKIE, getCurrentUserMemberships } from '../../lib/supabase/server';
import SettingsWorkspace from './settings-workspace';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { user, memberships } = await getCurrentUserMemberships();
  if (!user) redirect('/login');
  const active = memberships.filter((m) => m.status === 'active' && m.workspaces?.status === 'active');
  if (active.length === 0) redirect('/onboarding/workspace');
  const selected = cookies().get(ACTIVE_WORKSPACE_COOKIE)?.value;
  if (selected && !active.some((m) => m.workspace_id === selected)) redirect('/access-denied?reason=workspace-unauthorized');
  if (active.length > 1 && !active.some((m) => m.workspace_id === selected)) redirect('/workspace/select');
  return <SettingsWorkspace />;
}
