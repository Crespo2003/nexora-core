'use client';

import { useState } from 'react';

export type SwitcherWorkspace = { workspaceId: string; name: string; role: string };

export default function WorkspaceSwitcher({ workspaces }: { workspaces: SwitcherWorkspace[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function select(workspaceId: string) {
    setBusy(workspaceId); setError('');
    const response = await fetch('/api/workspaces/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId }) });
    if (!response.ok) { setBusy(null); setError('Unable to switch workspace / 无法切换工作区'); return; }
    window.location.assign('/home');
  }
  return <div className="workspace-list">{workspaces.map((workspace) => <button key={workspace.workspaceId} className="secondary-button" disabled={busy !== null} onClick={() => select(workspace.workspaceId)}><strong>{workspace.name}</strong><span>{workspace.role}</span>{busy === workspace.workspaceId ? ' …' : ''}</button>)}{error && <div className="notice warning">{error}</div>}</div>;
}
