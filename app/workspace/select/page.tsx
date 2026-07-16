import { redirect } from 'next/navigation';
import { getCurrentUserMemberships } from '../../../lib/supabase/server';
import WorkspaceSwitcher from './workspace-switcher';

export const dynamic = 'force-dynamic';

export default async function WorkspaceSelectPage() {
  const { user, memberships } = await getCurrentUserMemberships();
  if (!user) redirect('/login?next=/workspace/select');
  const active = memberships.filter((membership) => membership.status === 'active' && membership.workspaces?.status === 'active');
  if (active.length === 0) redirect('/onboarding/workspace');
  return <main className="auth-shell"><section className="auth-panel"><p className="eyebrow">NEXORA</p><h1>Select a workspace / 选择工作区</h1><p>Choose the organization you want to enter. / 请选择要进入的组织。</p><WorkspaceSwitcher workspaces={active.map((membership) => ({ workspaceId: membership.workspace_id, name: membership.workspaces?.name ?? 'Workspace', role: membership.role }))} /><a className="text-link" href="/onboarding/workspace">Create another workspace / 创建另一个工作区</a></section></main>;
}
