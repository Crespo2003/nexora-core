'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clock3, Plus, TrendingUp } from 'lucide-react';
import AppNav from '../components/AppNav';
import PortalWidgetBoundary from '../components/PortalWidgetBoundary';
import { usePortalLanguage } from '../components/usePortalLanguage';
import { formatMYR } from '../../lib/formatters';
import { currentIsoDate } from '../../lib/dates/formatDate';
import { getTranslations } from '../../lib/i18n/translations';
import type { NavPage, WorkspaceRole } from '../../lib/rbac/permissions';
import { canAccess } from '../../lib/rbac/permissions';
import { visiblePortalNavigation } from '../../lib/portal/navigation';

type Metrics = {
  activeTenancies: number;
  monthlyDue: number;
  monthlyPaid: number;
  collectionPct: number;
  outstandingTotal: number;
  renewalsThisMonth: number;
  expiringIn30Count: number;
};

type ExpiringItem = { id: string; tenant?: string | null; property?: string | null; unit_no?: string | null; expiry_date?: string | null };
type Activity = { id: string; entity_type?: string | null; activity_type?: string | null; activity_json?: Record<string, unknown> | null; created_at?: string | null };
type Followup = { id: string; title?: string | null; next_follow_up?: string | null; status?: string | null };
type DashboardData = {
  metrics: Metrics;
  expiringIn30: ExpiringItem[];
  recentActivities: Activity[];
  upcomingFollowups: Followup[];
};
type Deal = { id: string; title?: string | null; stage?: string | null; deal_value?: number | string | null; probability?: number | null; next_follow_up?: string | null };
type Appointment = { id: string; viewing_date?: string | null; location?: string | null; viewing_status?: string | null; attendees?: string[] | null };

type Loadable<T> = {
  data: T | null;
  loading: boolean;
  error: boolean;
};

const emptyMetrics: Metrics = {
  activeTenancies: 0,
  monthlyDue: 0,
  monthlyPaid: 0,
  collectionPct: 0,
  outstandingTotal: 0,
  renewalsThisMonth: 0,
  expiringIn30Count: 0,
};

const QUICK_ACTIONS: Array<{ key: keyof ReturnType<typeof getTranslations>['portal']['quickAdd']; href: string; permission: NavPage }> = [
  { key: 'enquiry', href: '/crm?action=new-enquiry', permission: 'crm' },
  { key: 'listing', href: '/listings?action=new-listing', permission: 'listings' },
  { key: 'viewing', href: '/viewings?action=new-viewing', permission: 'viewings' },
  { key: 'appointment', href: '/viewings?action=new-appointment', permission: 'viewings' },
  { key: 'deal', href: '/deals?action=new-deal', permission: 'deals' },
  { key: 'tenancy', href: '/?action=new-tenancy', permission: 'tenancies' },
  { key: 'commercialLead', href: '/commercial/leads?action=new-lead', permission: 'commercial' },
  { key: 'payment', href: '/collections?action=record-payment', permission: 'collections' },
  { key: 'document', href: '/documents?action=upload-document', permission: 'documents' },
  { key: 'legal', href: '/legal?action=new-legal-matter', permission: 'legal' },
  { key: 'contractor', href: '/contractors?action=new-contractor', permission: 'contractors' },
  { key: 'contact', href: '/contacts?action=new-contact', permission: 'contacts' },
];

async function fetchPayload<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json() as T & { success?: boolean };
  if (!response.ok || payload.success === false) throw new Error(`Unable to load ${url}`);
  return payload;
}

function safeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value?: string | null) {
  const date = safeDate(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
}

function displayDate(value: string | null | undefined, language: 'en' | 'zh') {
  const date = safeDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-MY', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function displayDateTime(value: string | null | undefined, language: 'en' | 'zh') {
  const date = safeDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-MY', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function activityText(activity: Activity) {
  const type = String(activity.activity_type ?? 'activity').replaceAll('_', ' ');
  const json = activity.activity_json ?? {};
  const detail = json.filename ?? json.tenant ?? json.title ?? '';
  return detail ? `${type} — ${String(detail)}` : type;
}

function WidgetFallback({ text }: { text: string }) {
  return <div className="portal-empty portal-widget-error" role="status"><strong>{text}</strong></div>;
}

export default function HomePortal({ initialRole }: { initialRole: WorkspaceRole }) {
  const language = usePortalLanguage();
  const t = getTranslations(language);
  const role = initialRole;
  const [quickOpen, setQuickOpen] = useState(false);
  const [dashboard, setDashboard] = useState<Loadable<DashboardData>>({ data: null, loading: true, error: false });
  const [deals, setDeals] = useState<Loadable<Deal[]>>({ data: null, loading: true, error: false });
  const [appointments, setAppointments] = useState<Loadable<Appointment[]>>({ data: null, loading: true, error: false });

  useEffect(() => {
    let active = true;
    const canLoadDeals = canAccess(initialRole, 'commercial');
    void Promise.allSettled([
      fetchPayload<DashboardData & { success: boolean }>('/api/dashboard'),
      canLoadDeals
        ? fetchPayload<{ success: boolean; rows?: Deal[] }>('/api/commercial/deals')
        : Promise.resolve({ success: true, rows: [] as Deal[] }),
      canLoadDeals
        ? fetchPayload<{ success: boolean; rows?: Appointment[] }>('/api/commercial/viewings')
        : Promise.resolve({ success: true, rows: [] as Appointment[] }),
    ]).then(([dashboardResult, dealsResult, appointmentsResult]) => {
      if (!active) return;
      setDashboard(dashboardResult.status === 'fulfilled'
        ? { data: { ...dashboardResult.value, metrics: dashboardResult.value.metrics ?? emptyMetrics }, loading: false, error: false }
        : { data: null, loading: false, error: true });
      setDeals(dealsResult.status === 'fulfilled'
        ? { data: dealsResult.value.rows ?? [], loading: false, error: false }
        : { data: null, loading: false, error: true });
      setAppointments(appointmentsResult.status === 'fulfilled'
        ? { data: appointmentsResult.value.rows ?? [], loading: false, error: false }
        : { data: null, loading: false, error: true });
    });
    return () => { active = false; };
  }, [initialRole]);

  const visibleWorkspaces = useMemo(() => {
    return visiblePortalNavigation(role).groups.flatMap((group) => group.items);
  }, [role]);

  const urgentItems = useMemo(() => {
    const data = dashboard.data;
    if (!data) return [];
    const expiries = (data.expiringIn30 ?? [])
      .filter((item) => {
        const days = daysUntil(item.expiry_date);
        return days !== null && days <= 1;
      })
      .map((item) => ({
        id: `expiry-${item.id}`,
        title: item.tenant || item.property || t.nav.tenancies,
        detail: [item.property, item.unit_no].filter(Boolean).join(' · '),
        href: `/tenancies/${item.id}`,
      }));
    const today = currentIsoDate();
    const followups = (data.upcomingFollowups ?? [])
      .filter((item) => item.next_follow_up?.slice(0, 10) === today)
      .map((item) => ({
        id: `followup-${item.id}`,
        title: item.title || t.portal.home.urgentToday,
        detail: item.status?.replaceAll('_', ' ') ?? '',
        href: '/commercial/follow-ups',
      }));
    return [...expiries, ...followups];
  }, [dashboard.data, t]);

  const quickActions = QUICK_ACTIONS.filter((action) => canAccess(role, action.permission));
  const activeDeals = (deals.data ?? []).filter((deal) => !['completed', 'lost', 'cancelled'].includes(deal.stage ?? ''));
  const upcomingAppointments = (appointments.data ?? [])
    .filter((appointment) => {
      const date = safeDate(appointment.viewing_date);
      return date && date.getTime() >= Date.now() && !['completed', 'cancelled'].includes(appointment.viewing_status ?? '');
    })
    .sort((left, right) => (safeDate(left.viewing_date)?.getTime() ?? 0) - (safeDate(right.viewing_date)?.getTime() ?? 0))
    .slice(0, 5);
  const metrics = dashboard.data?.metrics ?? emptyMetrics;

  return (
    <main className="command-shell portal-home">
      <header className="command-header portal-home-header">
        <div>
          <p className="eyebrow">{t.portal.home.eyebrow}</p>
          <h1>{t.portal.home.title}</h1>
          <p className="header-copy">{t.portal.home.subtitle}</p>
        </div>
        <AppNav activePage="home">
          <div className="portal-quick-add">
            <button type="button" className="portal-quick-add-trigger" onClick={() => setQuickOpen((value) => !value)} aria-expanded={quickOpen}>
              <Plus size={17} />
              <span>{t.portal.home.quickAdd}</span>
              <ChevronDown size={15} />
            </button>
            {quickOpen && (
              <div className="portal-quick-menu">
                {quickActions.map((action) => <a key={action.key} href={action.href}>{t.portal.quickAdd[action.key]}</a>)}
              </div>
            )}
          </div>
        </AppNav>
      </header>

      <div className="portal-home-layout">
        <PortalWidgetBoundary fallback={<WidgetFallback text={t.portal.home.widgetUnavailable} />}>
          <section className="panel portal-widget portal-urgent">
            <div className="portal-section-heading"><div><Clock3 size={18} /><h2>{t.portal.home.urgentToday}</h2></div></div>
            {dashboard.loading ? <div className="portal-line-skeleton" /> : dashboard.error ? <WidgetFallback text={t.portal.home.widgetUnavailable} /> : urgentItems.length === 0 ? (
              <div className="portal-empty"><strong>{t.portal.home.noUrgent}</strong></div>
            ) : (
              <ul className="portal-compact-list">
                {urgentItems.map((item) => <li key={item.id}><a href={item.href}><strong>{item.title}</strong><span>{item.detail}</span></a></li>)}
              </ul>
            )}
          </section>
        </PortalWidgetBoundary>

        <PortalWidgetBoundary fallback={<WidgetFallback text={t.portal.home.widgetUnavailable} />}>
          <section className="panel portal-widget portal-workspaces">
            <div className="portal-section-heading"><div><FolderKanbanIcon /><h2>{t.portal.home.workspaceGrid}</h2></div></div>
            <div className="portal-workspace-grid">
              {visibleWorkspaces.map((item) => (
                <a href={item.href} className="portal-workspace-card" key={item.key}>
                  <strong>{(t.nav as Record<string, string>)[item.labelKey] ?? item.labelKey}</strong>
                  <span>{t.portal.descriptions[item.descriptionKey as keyof typeof t.portal.descriptions]}</span>
                  <small>{t.portal.home.openWorkspace} →</small>
                </a>
              ))}
            </div>
          </section>
        </PortalWidgetBoundary>

        <PortalWidgetBoundary fallback={<WidgetFallback text={t.portal.home.widgetUnavailable} />}>
          <section className="panel portal-widget">
            <div className="portal-section-heading"><div><Clock3 size={18} /><h2>{t.portal.home.upcomingAppointments}</h2></div></div>
            {appointments.loading ? <div className="portal-line-skeleton" /> : appointments.error ? <WidgetFallback text={t.portal.home.widgetUnavailable} /> : upcomingAppointments.length === 0 ? (
              <div className="portal-empty">
                <strong>{t.portal.home.noAppointments}</strong>
                <span>{t.portal.home.noAppointmentsBody}</span>
              </div>
            ) : (
              <ul className="portal-compact-list">
                {upcomingAppointments.map((appointment) => (
                  <li key={appointment.id}>
                    <a href="/commercial">
                      <strong>{appointment.location || appointment.attendees?.join(', ') || '—'}</strong>
                      <span>{displayDateTime(appointment.viewing_date, language)} · {appointment.viewing_status ?? 'scheduled'}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </PortalWidgetBoundary>

        <PortalWidgetBoundary fallback={<WidgetFallback text={t.portal.home.widgetUnavailable} />}>
          <section className="panel portal-widget">
            <div className="portal-section-heading"><div><TrendingUp size={18} /><h2>{t.portal.home.dealPipeline}</h2></div><a href="/commercial/deals">{t.portal.home.openWorkspace} →</a></div>
            {deals.loading ? <div className="portal-line-skeleton" /> : deals.error ? <WidgetFallback text={t.portal.home.widgetUnavailable} /> : activeDeals.length === 0 ? (
              <div className="portal-empty"><strong>{t.portal.home.noDeals}</strong></div>
            ) : (
              <ul className="portal-compact-list">
                {activeDeals.slice(0, 5).map((deal) => (
                  <li key={deal.id}>
                    <a href={`/commercial/deals/${deal.id}`}>
                      <strong>{deal.title || '—'}</strong>
                      <span>{deal.stage?.replaceAll('_', ' ') ?? '—'}{deal.deal_value ? ` · ${formatMYR(Number(deal.deal_value))}` : ''}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </PortalWidgetBoundary>

        <PortalWidgetBoundary fallback={<WidgetFallback text={t.portal.home.widgetUnavailable} />}>
          <section className="panel portal-widget">
            <div className="portal-section-heading"><div><Clock3 size={18} /><h2>{t.portal.home.recentActivity}</h2></div></div>
            {dashboard.loading ? <div className="portal-line-skeleton" /> : dashboard.error ? <WidgetFallback text={t.portal.home.widgetUnavailable} /> : (dashboard.data?.recentActivities ?? []).length === 0 ? (
              <div className="portal-empty"><strong>{t.portal.home.noActivity}</strong></div>
            ) : (
              <ul className="portal-activity-list">
                {(dashboard.data?.recentActivities ?? []).slice(0, 6).map((activity) => (
                  <li key={activity.id}><span className="portal-activity-dot" /><div><strong>{activityText(activity)}</strong><span>{displayDate(activity.created_at, language)}</span></div></li>
                ))}
              </ul>
            )}
          </section>
        </PortalWidgetBoundary>

        <PortalWidgetBoundary fallback={<WidgetFallback text={t.portal.home.widgetUnavailable} />}>
          <section className="panel portal-widget portal-business-snapshot">
            <div className="portal-section-heading"><div><TrendingUp size={18} /><h2>{t.portal.home.businessSnapshot}</h2></div><a href="/dashboard">{t.portal.home.openWorkspace} →</a></div>
            {dashboard.loading ? <div className="portal-card-skeletons">{Array.from({ length: 5 }).map((_, index) => <span key={index} />)}</div> : dashboard.error ? <WidgetFallback text={t.portal.home.widgetUnavailable} /> : (
              <div className="portal-metric-grid">
                <Metric label={t.portal.home.activeTenancies} value={String(metrics.activeTenancies)} />
                <Metric label={t.portal.home.collectionRate} value={`${metrics.collectionPct}%`} />
                <Metric label={t.portal.home.outstanding} value={formatMYR(metrics.outstandingTotal)} />
                <Metric label={t.portal.home.expiringSoon} value={String(metrics.expiringIn30Count)} />
                <Metric label={t.portal.home.renewalsThisMonth} value={String(metrics.renewalsThisMonth)} />
              </div>
            )}
          </section>
        </PortalWidgetBoundary>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="portal-metric"><span>{label}</span><strong>{value}</strong></article>;
}

function FolderKanbanIcon() {
  return <span className="portal-section-symbol" aria-hidden="true">N</span>;
}
