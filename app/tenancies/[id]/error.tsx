'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';

export default function TenancyWorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="tw-shell">
      <div className="tw-loading" role="alert">
        <TriangleAlert size={30} />
        <h1>Tenancy workspace interrupted</h1>
        <p>The record is safe. Reload this workspace to continue.</p>
        <button className="tw-primary" onClick={reset}><RefreshCw size={16} /> Reload workspace</button>
      </div>
    </main>
  );
}
