'use client';

export default function HomeError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="command-shell">
      <section className="panel portal-placeholder-card">
        <h1>Home portal could not be loaded</h1>
        <p>Other Nexora workspaces remain available. Retry this page when you are ready.</p>
        <button type="button" className="primary-button portal-inline-button" onClick={reset}>Retry</button>
      </section>
    </main>
  );
}
