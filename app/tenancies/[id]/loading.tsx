export default function TenancyWorkspaceLoading() {
  return (
    <main className="tw-shell" aria-busy="true" aria-label="Loading tenancy workspace">
      <div className="tw-topbar"><div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line" /></div>
      <div className="tw-dashboard skeleton-grid">{Array.from({ length: 6 }, (_, index) => <div key={index} />)}</div>
      <div className="skeleton-panel"><div className="skeleton-card" /><div className="skeleton-card" /><div className="skeleton-card" /></div>
    </main>
  );
}
