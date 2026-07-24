'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clock3, Plus, TrendingUp } from 'lucide-react';
import AppNav from '../components/AppNav';
import PortalWidgetBoundary from '../components/PortalWidgetBoundary';
import { usePortalLanguage } from '../components/usePortalLanguage';
import { formatMYR } from '../../lib/formatters';
import { currentIsoDate } from '../../lib/dates/formatDate';
import { getTranslations } from '../../lib/i18n/translations';
import { crmStageLabel, isCrmPipelineStage } from '../../lib/crm/pipeline';
import { crmEnumLabel } from '../../lib/i18n/crm';
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
type Deal = { id: string; title?: string | null; stage?: string | null; deal_value?: number | string | null; probability?: number | null; updated_at?: string | null };
type Appointment = { id: string; title?: string | null; start_at?: string | null; location?: string | null; status?: string | null; appointment_type?: string | null; contact?: { full_name?: string | null; company_name?: string | null } | null };
type CrmSummary = {
  deals: Deal[];
  appointments: Appointment[];
  urgent: Array<{ id: string; title?: string | null; due_at?: string | null; priority?: string | null; enquiry_id?: string | null; deal_id?: string | null }>;
  recentActivity: Activity[];
  metrics: { activeEnquiries: number; newEnquiriesToday: number; hotLeads: number; followUpsDueToday: number; viewingsToday: number; activeDeals: number; activeDealValue: number };
};

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
  { key: 'viewing', href: '/appointments?action=new-viewing', permission: 'viewings' },
  { key: 'appointment', href: '/appointments?action=new-appointment', permission: 'viewings' },
  { key: 'followUp', href: '/crm?action=new-follow-up', permission: 'crm' },
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
  const [crm, setCrm] = useState<Loadable<CrmSummary>>({ data: null, loading: true, error: false });

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      fetchPayload<DashboardData & { success: boolean }>('/api/dashboard'),
      fetchPayload<CrmSummary & { success: boolean }>('/api/crm/summary'),
    ]).then(([dashboardResult, crmResult]) => {
      if (!active) return;
      setDashboard(dashboardResult.status === 'fulfilled'
        ? { data: { ...dashboardResult.value, metrics: dashboardResult.value.metrics ?? emptyMetrics }, loading: false, error: false }
        : { data: null, loading: false, error: true });
      setCrm(crmResult.status === 'fulfilled'
        ? { data: crmResult.value, loading: false, error: false }
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
    const crmFollowups = (crm.data?.urgent ?? []).map((item) => ({
      id: `crm-followup-${item.id}`,
      title: item.title || t.portal.home.urgentToday,
      detail: item.priority ? crmEnumLabel(item.priority, language) : '',
      href: item.enquiry_id ? `/crm?enquiry=${item.enquiry_id}` : '/crm',
    }));
    return [...expiries, ...followups, ...crmFollowups];
  }, [crm.data, dashboard.data, t]);

  const quickActions = QUICK_ACTIONS.filter((action) => canAccess(role, action.permission));
  const activeDeals = (crm.data?.deals ?? []).filter((deal) => !['CLOSED', 'LOST', 'AFTER_SALES'].includes(deal.stage ?? ''));
  const upcomingAppointments = (crm.data?.appointments ?? [])
    .filter((appointment) => {
      const date = safeDate(appointment.start_at);
      return date && date.getTime() >= Date.now() && !['completed', 'cancelled'].includes(appointment.status ?? '');
    })
    .sort((left, right) => (safeDate(left.start_at)?.getTime() ?? 0) - (safeDate(right.start_at)?.getTime() ?? 0))
    .slice(0, 5);
  const metrics = dashboard.data?.metrics ?? emptyMetrics;
  const recentActivities = [...(crm.data?.recentActivity ?? []), ...(dashboard.data?.recentActivities ?? [])]
    .sort((left, right) => (safeDate(right.created_at)?.getTime() ?? 0) - (safeDate(left.created_at)?.getTime() ?? 0))
    .slice(0, 6);

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
            {crm.loading ? <div className="portal-line-skeleton" /> : crm.error ? <WidgetFallback text={t.portal.home.widgetUnavailable} /> : upcomingAppointments.length === 0 ? (
              <div className="portal-empty">
                <strong>{t.portal.home.noAppointments}</strong>
                <span>{t.portal.home.noAppointmentsBody}</span>
              </div>
            ) : (
              <ul className="portal-compact-list">
                {upcomingAppointments.map((appointment) => (
                  <li key={appointment.id}>
                    <a href="/appointments">
                      <strong>{appointment.title || appointment.location || appointment.contact?.full_name || appointment.contact?.company_name || '—'}</strong>
                      <span>{displayDateTime(appointment.start_at, language)} · {appointment.status ?? 'scheduled'}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </PortalWidgetBoundary>

        <PortalWidgetBoundary fallback={<WidgetFallback text={t.portal.home.widgetUnavailable} />}>
          <section className="panel portal-widget">
            <div className="portal-section-heading"><div><TrendingUp size={18} /><h2>{t.portal.home.dealPipeline}</h2></div><a href="/deals">{t.portal.home.openWorkspace} →</a></div>
            {crm.loading ? <div className="portal-line-skeleton" /> : crm.error ? <WidgetFallback text={t.portal.home.widgetUnavailable} /> : activeDeals.length === 0 ? (
              <div className="portal-empty"><strong>{t.portal.home.noDeals}</strong></div>
            ) : (
              <ul className="portal-compact-list">
                {activeDeals.slice(0, 5).map((deal) => (
                  <li key={deal.id}>
                    <a href="/deals">
                      <strong>{deal.title || '—'}</strong>
                      <span>{isCrmPipelineStage(deal.stage) ? crmStageLabel(deal.stage, language) : deal.stage?.replaceAll('_', ' ') ?? '—'}{deal.deal_value ? ` · ${formatMYR(Number(deal.deal_value))}` : ''}</span>
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
            {dashboard.loading && crm.loading ? <div className="portal-line-skeleton" /> : dashboard.error && crm.error ? <WidgetFallback text={t.portal.home.widgetUnavailable} /> : recentActivities.length === 0 ? (
              <div className="portal-empty"><strong>{t.portal.home.noActivity}</strong></div>
            ) : (
              <ul className="portal-activity-list">
                {recentActivities.map((activity) => (
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
                <Metric label={language === 'zh' ? '今日新询盘' : 'New enquiries today'} value={String(crm.data?.metrics.newEnquiriesToday ?? 0)} />
                <Metric label={language === 'zh' ? '热门客户' : 'Hot leads'} value={String(crm.data?.metrics.hotLeads ?? 0)} />
                <Metric label={language === 'zh' ? '今日待跟进' : 'Follow-ups due today'} value={String(crm.data?.metrics.followUpsDueToday ?? 0)} />
                <Metric label={language === 'zh' ? '今日看房' : 'Viewings today'} value={String(crm.data?.metrics.viewingsToday ?? 0)} />
                <Metric label={language === 'zh' ? '活跃交易' : 'Active deals'} value={String(crm.data?.metrics.activeDeals ?? 0)} />
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
