'use client';

import { useEffect, useState } from 'react';
import { formatMYR } from '../../lib/formatters';

type Metric = {
  activeTenancies: number;
  monthlyDue: number;
  monthlyPaid: number;
  collectionPct: number;
  outstandingTotal: number;
  renewalsThisMonth: number;
  expiringIn30Count: number;
};

type ExpiringItem = { id: string; tenant: string; property: string; unit_no: string; expiry_date: string };
type TopProperty = { name: string; count: number };
type Activity = { id: string; entity_type: string; activity_type: string; activity_json: Record<string, unknown>; created_at: string };
type Lead = { id: string; title: string; status: string; requirement_type: string; updated_at: string };
type Followup = { id: string; title: string; next_follow_up: string; status: string };

type DashboardData = {
  metrics: Metric;
  expiringIn30: ExpiringItem[];
  topProperties: TopProperty[];
  recentActivities: Activity[];
  leads: Lead[];
  upcomingFollowups: Followup[];
};

function kpiClass(type: string) {
  if (type === 'danger') return 'metric danger';
  if (type === 'success') return 'metric success';
  return 'metric';
}

function KpiCard({ label, value, type }: { label: string; value: string; type?: string }) {
  return (
    <article className={kpiClass(type ?? '')}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function activityLabel(act: Activity): string {
  const type = act.activity_type.replaceAll('_', ' ');
  const json = act.activity_json ?? {};
  const detail = String(json.filename ?? json.tenant ?? json.title ?? '');
  return detail ? `${type} — ${detail}` : type;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function DashboardWorkspace() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((payload: { success: boolean; metrics?: Metric } & Partial<DashboardData>) => {
        if (payload.success && payload.metrics) {
          setData(payload as DashboardData);
        } else {
          setError('Could not load dashboard data.');
        }
      })
      .catch(() => setError('Could not load dashboard data.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="command-shell">
      <header className="command-header">
        <div>
          <p className="eyebrow">Nexora · Sprint 004</p>
          <h1>Dashboard</h1>
          <p className="header-copy">Live overview of your property portfolio and operations.</p>
        </div>
        <div className="header-actions">
          <nav className="top-nav" aria-label="Primary">
            <a className="ghost-button active" href="/dashboard">Dashboard</a>
            <a className="ghost-button" href="/">Rental Command Centre</a>
            <a className="ghost-button" href="/documents">Documents</a>
            <a className="ghost-button" href="/collections">Collections</a>
            <a className="ghost-button" href="/commercial">Commercial CRM</a>
            <a className="ghost-button" href="/settings">Settings</a>
          </nav>
        </div>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}

      {loading ? (
        <div className="dash-skeleton">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton-card" />)}
        </div>
      ) : data ? (
        <>
          <section className="metrics-grid dash-metrics" aria-label="Key metrics">
            <KpiCard label="Active Tenancies" value={String(data.metrics.activeTenancies)} />
            <KpiCard label="Monthly Due" value={formatMYR(data.metrics.monthlyDue)} />
            <KpiCard label="Monthly Collected" value={formatMYR(data.metrics.monthlyPaid)} type={data.metrics.collectionPct >= 80 ? 'success' : 'danger'} />
            <KpiCard label="Collection Rate" value={`${data.metrics.collectionPct}%`} type={data.metrics.collectionPct >= 80 ? 'success' : 'danger'} />
            <KpiCard label="Outstanding" value={formatMYR(data.metrics.outstandingTotal)} type={data.metrics.outstandingTotal > 0 ? 'danger' : 'success'} />
            <KpiCard label="Expiring in 30 Days" value={String(data.metrics.expiringIn30Count)} type={data.metrics.expiringIn30Count > 0 ? 'danger' : 'success'} />
          </section>

          <div className="dash-body">
            <div className="dash-col">
              <section className="panel dash-section">
                <h2 className="dash-section-title">Top Properties</h2>
                {data.topProperties.length === 0 ? (
                  <p className="dash-empty">No active tenancies yet.</p>
                ) : (
                  <ul className="dash-list">
                    {data.topProperties.map((p) => (
                      <li key={p.name} className="dash-list-row">
                        <span className="dash-list-name">{p.name}</span>
                        <span className="dash-list-badge">{p.count} unit{p.count > 1 ? 's' : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="panel dash-section">
                <h2 className="dash-section-title">Expiring Soon</h2>
                {data.expiringIn30.length === 0 ? (
                  <p className="dash-empty">No tenancies expiring in the next 30 days.</p>
                ) : (
                  <ul className="dash-list">
                    {data.expiringIn30.map((t) => (
                      <li key={t.id} className="dash-list-row">
                        <div>
                          <span className="dash-list-name">{t.tenant}</span>
                          <span className="dash-list-sub">{t.property}{t.unit_no ? ' · ' + t.unit_no : ''}</span>
                        </div>
                        <span className="dash-expiry-pill" data-urgent={daysUntil(t.expiry_date) <= 14}>
                          {daysUntil(t.expiry_date)}d
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div className="dash-col">
              <section className="panel dash-section">
                <h2 className="dash-section-title">Recent Activity</h2>
                {data.recentActivities.length === 0 ? (
                  <p className="dash-empty">No recent activity.</p>
                ) : (
                  <ul className="dash-activity-list">
                    {data.recentActivities.map((a) => (
                      <li key={a.id} className="dash-activity-row">
                        <span className="dash-activity-dot" data-type={a.entity_type} />
                        <div className="dash-activity-body">
                          <span className="dash-activity-label">{activityLabel(a)}</span>
                          <span className="dash-activity-time">{timeAgo(a.created_at)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div className="dash-col">
              <section className="panel dash-section">
                <h2 className="dash-section-title">Active Leads</h2>
                {data.leads.length === 0 ? (
                  <p className="dash-empty">No open commercial leads.</p>
                ) : (
                  <ul className="dash-list">
                    {data.leads.map((l) => (
                      <li key={l.id} className="dash-list-row">
                        <div>
                          <span className="dash-list-name">{l.title}</span>
                          <span className="dash-list-sub">{l.requirement_type?.replaceAll('_', ' ')}</span>
                        </div>
                        <span className="dash-status-chip">{l.status?.replaceAll('_', ' ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="panel dash-section">
                <h2 className="dash-section-title">Upcoming Follow-ups</h2>
                {data.upcomingFollowups.length === 0 ? (
                  <p className="dash-empty">No follow-ups in the next 30 days.</p>
                ) : (
                  <ul className="dash-list">
                    {data.upcomingFollowups.map((f) => (
                      <li key={f.id} className="dash-list-row">
                        <span className="dash-list-name">{f.title}</span>
                        <span className="dash-list-sub">{f.next_follow_up}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
