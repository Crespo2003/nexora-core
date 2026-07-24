'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Building2, CalendarClock, Check, ChevronRight, CircleDollarSign, ClipboardList,
  Download, Eye, FileText, Filter, Handshake, Image, Languages, LayoutDashboard, ListFilter, MapPin, Menu, Plus,
  RefreshCw, Search, Sparkles, Store, Target, Trash2, Upload, UserRound, UsersRound, X
} from 'lucide-react';
import { nextDealStages } from '../../lib/commercial/deals';
import { DateInput, DateTimeInput } from '../../lib/dates/DateInput';
import { currentIsoMonth, displayDateTimeToIso, formatNexoraDate, formatNexoraDateTime } from '../../lib/dates/formatDate';
import { formatMYR } from '../../lib/formatters';

type View = 'dashboard' | 'companies' | 'contacts' | 'requirements' | 'listings' | 'matches' | 'deals' | 'followups' | 'leads';
type Row = Record<string, unknown> & { id: string };
type Language = 'en' | 'zh';

const nav: Array<{ view: View; href: string; en: string; zh: string; icon: typeof Store }> = [
  { view: 'dashboard', href: '/commercial', en: 'Command Centre', zh: '商业指挥中心', icon: LayoutDashboard },
  { view: 'companies', href: '/commercial/companies', en: 'Companies', zh: '公司与品牌', icon: Building2 },
  { view: 'contacts', href: '/commercial/contacts', en: 'Contacts', zh: '联系人', icon: UsersRound },
  { view: 'requirements', href: '/commercial/requirements', en: 'Requirements', zh: '物业需求', icon: ClipboardList },
  { view: 'listings', href: '/commercial/listings', en: 'Listings', zh: '商业盘源', icon: Store },
  { view: 'matches', href: '/commercial/matches', en: 'Matches', zh: '智能配对', icon: Sparkles },
  { view: 'leads', href: '/commercial/leads', en: 'Lead Pipeline', zh: '线索管道', icon: Target },
  { view: 'deals', href: '/commercial/deals', en: 'Deals', zh: '交易管道', icon: Handshake },
  { view: 'followups', href: '/commercial/follow-ups', en: 'Follow-ups', zh: '跟进中心', icon: CalendarClock }
];

const copy = {
  en: { search: 'Search commercial CRM', create: 'Create', empty: 'No live records yet', emptyBody: 'Create the first record or import a validated CSV.', loading: 'Loading live workspace data', error: 'Commercial data could not be loaded.', retry: 'Retry', export: 'Export CSV', import: 'Import preview', save: 'Save record', cancel: 'Cancel', filters: 'Filters', run: 'Run matching', selectRequirement: 'Select a requirement', score: 'Score', strengths: 'Strengths', gaps: 'Missing / warnings', conflicts: 'Hard conflicts', pipeline: 'Pipeline', table: 'Table', noAccess: 'Your role is read-only for this action.' },
  zh: { search: '搜索商业 CRM', create: '新建', empty: '暂无实时记录', emptyBody: '创建第一条记录，或预览并验证 CSV 导入。', loading: '正在加载实时工作区数据', error: '无法加载商业数据。', retry: '重试', export: '导出 CSV', import: '导入预览', save: '保存记录', cancel: '取消', filters: '筛选', run: '开始配对', selectRequirement: '选择一个物业需求', score: '评分', strengths: '优势', gaps: '缺失 / 警告', conflicts: '硬性冲突', pipeline: '管道', table: '列表', noAccess: '您的角色对此操作只有读取权限。' }
};

export default function CommercialWorkspace({ view, detailId }: { view: View; detailId?: string }) {
  const [language, setLanguage] = useState<Language>('en');
  const [rows, setRows] = useState<Row[]>([]);
  const [globalRows, setGlobalRows] = useState<Row[]>([]);
  const [dashboard, setDashboard] = useState<Record<string, Row[]>>({});
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [pipelineMode, setPipelineMode] = useState<'kanban' | 'table'>('kanban');
  const [mobileNav, setMobileNav] = useState(false);
  const [requirementId, setRequirementId] = useState('');
  const [matchResults, setMatchResults] = useState<Array<{ listing: Row; result: Row }>>([]);
  const t = copy[language];
  const canEdit = ['owner', 'admin', 'manager', 'agent'].includes(role) || (view === 'deals' && role === 'finance');
  const resource = view === 'dashboard' ? null : view === 'followups' ? 'followups' : view === 'leads' ? 'requirements' : view;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (query) {
        const response = await fetch(`/api/commercial/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
        const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.error ?? 'search-failed');
        setGlobalRows(result.rows); setRole(result.role);
      } else if (view === 'dashboard') {
        const resources = ['companies', 'requirements', 'listings', 'matches', 'deals', 'followups', 'proposals', 'viewings'];
        const responses = await Promise.all(resources.map((item) => fetch(`/api/commercial/${item}`, { cache: 'no-store' }).then((response) => response.json())));
        if (responses.some((response) => !response.success)) throw new Error('dashboard-load-failed');
        setDashboard(Object.fromEntries(resources.map((item, index) => [item, responses[index].rows])));
        setRole(responses[0].role);
      } else if (view === 'matches') {
        const [requirements, matches] = await Promise.all([
          fetch('/api/commercial/requirements', { cache: 'no-store' }).then((response) => response.json()),
          fetch('/api/commercial/matches', { cache: 'no-store' }).then((response) => response.json())
        ]);
        if (!requirements.success || !matches.success) throw new Error('match-load-failed');
        setDashboard({ requirements: requirements.rows }); setRows(matches.rows); setRole(matches.role);
      } else if (view === 'followups') {
        const response = await fetch('/api/commercial/followups/overview', { cache:'no-store' }); const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.error ?? 'followups-load-failed'); setRows(result.rows); setRole(result.role);
      } else if (resource) {
        const params = new URLSearchParams(); if (detailId) params.set('id', detailId); if (query) params.set('search', query);
        const response = await fetch(`/api/commercial/${resource}?${params}`, { cache: 'no-store' });
        const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.technicalReference ?? 'load-failed');
        setRows(result.rows); setRole(result.role);
      }
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'load-failed'); }
    finally { setLoading(false); }
  }, [detailId, query, resource, view]);

  useEffect(() => { const timer = setTimeout(() => void load(), query ? 250 : 0); return () => clearTimeout(timer); }, [load, query]);
  const title = nav.find((item) => item.view === view)?.[language] ?? 'Commercial';

  async function runMatching() {
    if (!requirementId) return;
    setNotice(''); setLoading(true);
    try {
      const response = await fetch('/api/commercial/matches/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requirementId }) });
      const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.error ?? 'matching-failed');
      setMatchResults(result.matches); setNotice(language === 'zh' ? `已评估 ${result.matches.length} 个商业盘源。` : `${result.matches.length} listings evaluated.`);
    } catch { setNotice(t.error); } finally { setLoading(false); }
  }

  async function actOnMatch(matchId: string, action: 'shortlist' | 'reject' | 'deal' | 'viewing' | 'proposal') {
    if (!matchId) return;
    const reason = action === 'reject' ? window.prompt(language === 'zh' ? '请输入拒绝原因' : 'Reason for rejection') ?? '' : '';
    if (action === 'reject' && !reason) return;
    setNotice('');
    try {
      const response = await fetch('/api/commercial/matches/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId, action, reason }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error ?? 'match-action-failed');
      if (action === 'proposal') { window.location.href = `/commercial/proposals/${result.recordId}`; return; }
      if (action === 'deal') { window.location.href = `/commercial/deals/${result.recordId}`; return; }
      setNotice(language === 'zh' ? '操作已保存。' : 'Action saved.');
      await load();
    } catch { setNotice(t.error); }
  }

  async function actOnFollowup(id: string, action: 'complete' | 'reschedule' | 'note' | 'assign') {
    const dueAt = action === 'reschedule' ? window.prompt(language === 'zh' ? '新的日期时间（DD/MM/YYYY HH:mm）' : 'New date and time (DD/MM/YYYY HH:mm)') : null;
    if (action === 'reschedule' && !dueAt) return;
    const note = action === 'note' ? window.prompt(language === 'zh' ? '输入跟进备注' : 'Enter follow-up note') : null;
    if (action === 'note' && !note) return;
    const assignedUserId = action === 'assign' ? window.prompt(language === 'zh' ? '输入工作区用户 ID' : 'Enter workspace user ID') : null;
    if (action === 'assign' && !assignedUserId) return;
    try {
      const rescheduledAt = dueAt ? displayDateTimeToIso(dueAt) : null;
      if (action === 'reschedule' && !rescheduledAt) { setNotice(language === 'zh' ? '请输入 DD/MM/YYYY HH:mm 格式。' : 'Use DD/MM/YYYY HH:mm.'); return; }
      const changes = action === 'complete' ? { id, status: 'completed', completed_at: new Date().toISOString() } : action === 'reschedule' ? { id, due_at: rescheduledAt, status: 'open' } : action === 'note' ? { id, note } : { id, assigned_user_id: assignedUserId };
      const response = await fetch('/api/commercial/followups', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
      const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.technicalReference ?? 'followup-action-failed');
      setNotice(language === 'zh' ? '跟进已更新。' : 'Follow-up updated.'); await load();
    } catch { setNotice(t.error); }
  }

  async function advanceLead(id: string, status: string) {
    try {
      const response = await fetch('/api/commercial/requirements', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.technicalReference ?? 'advance-failed');
      setNotice(language === 'zh' ? '线索已推进。' : 'Lead advanced.');
      void load();
    } catch { setNotice(t.error); }
  }

  return <main className="commercial-app">
    <aside className={`commercial-sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="commercial-brand"><span>N</span><div><strong>Nexora</strong><small>Commercial OS</small></div><button onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <nav>{nav.map((item) => { const Icon = item.icon; return <Link key={item.view} href={item.href} className={item.view === view ? 'active' : ''}><Icon size={17} /><span>{item[language]}</span></Link>; })}</nav>
      <Link href="/home" className="commercial-back"><ArrowLeft size={16} />{language === 'zh' ? '返回首页' : 'Back to Home'}</Link>
    </aside>
    <section className="commercial-main">
      <header className="commercial-header">
        <button className="commercial-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button>
        <div><p>Nexora / Commercial</p><h1>{title}</h1></div>
        <div className="commercial-header-actions">
          <label className="commercial-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} /></label>
          <button className="commercial-icon" onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')} title="Language"><Languages size={18} /><span>{language === 'en' ? '中' : 'EN'}</span></button>
          <button className="commercial-icon" onClick={() => void load()} title="Refresh"><RefreshCw size={18} /></button>
        </div>
      </header>
      {notice && <div className="commercial-notice">{notice}</div>}
      {loading ? <Loading text={t.loading} /> : error ? <ErrorState text={t.error} retry={() => void load()} label={t.retry} /> :
        query ? <GlobalResults rows={globalRows} language={language} /> :
        view === 'dashboard' ? <Dashboard data={dashboard} language={language} /> :
        view === 'matches' ? <Matches language={language} requirements={dashboard.requirements ?? []} stored={rows} results={matchResults} requirementId={requirementId} setRequirementId={setRequirementId} run={() => void runMatching()} action={(id, value) => void actOnMatch(id, value)} t={t} /> :
        view === 'deals' ? <Deals rows={rows} language={language} mode={pipelineMode} setMode={setPipelineMode} /> :
        view === 'followups' ? <Followups rows={rows} language={language} action={(id, value) => void actOnFollowup(id, value)} /> :
        view === 'leads' ? <LeadPipeline rows={rows} language={language} onAdvance={(id, status) => void advanceLead(id, status)} /> :
        detailId ? <Detail view={view} row={rows[0]} language={language} role={role} /> :
        <RecordList view={view} rows={rows} language={language} />}
    </section>
    {resource && !detailId && view !== 'matches' && <div className="commercial-floating-actions">
      <a href={`/api/commercial/csv?resource=${resource}`} className="commercial-secondary"><Download size={16} />{t.export}</a>
      {['companies','contacts','requirements','listings'].includes(resource) && canEdit && <button className="commercial-secondary" onClick={() => setImportOpen(true)}><Upload size={16} />{t.import}</button>}
      {canEdit ? <button className="commercial-primary" onClick={() => setFormOpen(true)}><Plus size={16} />{t.create}</button> : <span>{t.noAccess}</span>}
    </div>}
    {formOpen && resource && <RecordForm resource={view === 'leads' ? 'leads' : resource} language={language} close={() => setFormOpen(false)} saved={() => { setFormOpen(false); setNotice(language === 'zh' ? '记录已保存。' : 'Record saved.'); void load(); }} />}
    {importOpen && resource && <CsvImportModal resource={resource} language={language} close={() => setImportOpen(false)} completed={(count) => { setImportOpen(false); setNotice(language === 'zh' ? `已导入 ${count} 条记录。` : `${count} records imported.`); void load(); }} />}
  </main>;
}

function Dashboard({ data, language }: { data: Record<string, Row[]>; language: Language }) {
  const deals = data.deals ?? []; const followups = data.followups ?? []; const now = new Date(); const month = currentIsoMonth(now);
  const metrics = [
    ['Active requirements', '有效需求', (data.requirements ?? []).filter((row) => !['completed','lost','cancelled'].includes(String(row.status))).length],
    ['Active listings', '有效盘源', (data.listings ?? []).filter((row) => row.status === 'active').length],
    ['Excellent matches', '优秀配对', (data.matches ?? []).filter((row) => Number(row.overall_score) >= 85).length],
    ['Proposals awaiting response', '待回复提案', (data.proposals ?? []).filter((row) => !row.response_date && !['accepted','rejected','cancelled'].includes(String(row.status))).length],
    ['Viewings this week', '本周看房', (data.viewings ?? []).filter((row) => { const date = String(row.viewing_date ?? ''); return date >= now.toISOString() && date <= new Date(now.getTime() + 7 * 86_400_000).toISOString(); }).length],
    ['Overdue follow-ups', '逾期跟进', followups.filter((row) => row.status === 'open' && String(row.due_at) < now.toISOString()).length],
    ['Expected pipeline', '预计管道价值', currency(deals.reduce((sum, row) => sum + Number(row.deal_value ?? 0) * Number(row.probability ?? 0) / 100, 0))],
    ['Expected commission', '预计佣金', currency(deals.reduce((sum, row) => sum + Number(row.expected_commission ?? 0) * Number(row.probability ?? 0) / 100, 0))],
    ['Negotiations', '谈判中', deals.filter((row) => row.stage === 'negotiation').length],
    ['Closed this month', '本月成交', deals.filter((row) => row.stage === 'completed' && String(row.actual_close_date ?? '').startsWith(month)).length]
  ];
  return <><div className="commercial-metrics">{metrics.map(([en, zh, value]) => <div key={String(en)}><span>{language === 'zh' ? zh : en}</span><strong>{value}</strong></div>)}</div>
    <div className="commercial-dashboard-grid"><section><SectionTitle icon={Sparkles} title={language === 'zh' ? '最新优秀配对' : 'Top recent matches'} /><RecordRows view="matches" rows={(data.matches ?? []).slice(0, 6)} language={language} /></section><section><SectionTitle icon={CalendarClock} title={language === 'zh' ? '下一步行动' : 'Next actions'} /><RecordRows view="followups" rows={followups.slice(0, 6)} language={language} /></section></div></>;
}

function GlobalResults({ rows, language }: { rows: Row[]; language: Language }) {
  if (!rows.length) return <Empty language={language} />;
  return <section className="commercial-list-section"><div className="commercial-section-head"><SectionTitle icon={Search} title={language === 'zh' ? '全局搜索结果' : 'Global search results'} /><span>{rows.length}</span></div><div className="commercial-table">{rows.map((row) => { const resource = String(row._resource); const view = resource === 'brands' ? 'companies' : resource as View; const href = resource === 'brands' ? '/commercial/companies' : detailHref(view, row.id); return <Link key={`${resource}-${row.id}`} href={href} className="commercial-row"><div className="commercial-row-main"><span className="commercial-record-icon">{recordIcon(view)}</span><div><strong>{primary(row, view)}</strong><small>{label(resource)} · {secondary(row, view)}</small></div></div><ChevronRight size={16} /></Link>; })}</div></section>;
}

function RecordList({ view, rows, language }: { view: View; rows: Row[]; language: Language }) {
  return <section className="commercial-list-section"><div className="commercial-section-head"><SectionTitle icon={ListFilter} title={language === 'zh' ? '实时工作区记录' : 'Live workspace records'} /><span>{rows.length}</span></div><RecordRows view={view} rows={rows} language={language} /></section>;
}

function RecordRows({ view, rows, language }: { view: View; rows: Row[]; language: Language }) {
  if (!rows.length) return <Empty language={language} />;
  return <div className="commercial-table">{rows.map((row) => <Link key={row.id} href={detailHref(view, row.id)} className="commercial-row">
    <div className="commercial-row-main"><span className="commercial-record-icon">{recordIcon(view)}</span><div><strong>{primary(row, view)}</strong><small>{secondary(row, view)}</small></div></div>
    <div className="commercial-row-meta"><span>{statusLabel(String(row.status ?? row.stage ?? row.recommendation_level ?? ''), language)}</span>{row.next_follow_up ? <small>{date(row.next_follow_up)}</small> : null}<ChevronRight size={16} /></div>
  </Link>)}</div>;
}

function Matches({ language, requirements, stored, results, requirementId, setRequirementId, run, action, t }: { language: Language; requirements: Row[]; stored: Row[]; results: Array<{ listing: Row; result: Row }>; requirementId: string; setRequirementId: (value: string) => void; run: () => void; action: (id: string, value: 'shortlist' | 'reject' | 'deal' | 'viewing' | 'proposal') => void; t: typeof copy.en }) {
  const display = results.length ? results : stored.map((row) => ({ listing: { id: String(row.listing_id), title: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Row).listingTitle : 'Stored listing match' } as Row, result: { ...row, overallScore: row.overall_score, recommendationLevel: row.recommendation_level, matchedCriteria: row.matched_criteria, missingCriteria: row.missing_criteria, hardConflicts: row.hard_conflicts } as Row }));
  return <section className="commercial-match-workspace"><div className="commercial-match-controls"><label><span>{t.selectRequirement}</span><select value={requirementId} onChange={(event) => setRequirementId(event.target.value)}><option value="">-</option>{requirements.map((row) => <option key={row.id} value={row.id}>{String(row.title)}</option>)}</select></label><button className="commercial-primary" disabled={!requirementId} onClick={run}><Sparkles size={16} />{t.run}</button><button className="commercial-secondary"><Filter size={16} />{t.filters}</button></div>
    {!display.length ? <Empty language={language} /> : <div className="commercial-match-list">{display.map(({ listing, result }) => { const matchId = String(result.matchId ?? result.id ?? ''); return <article key={listing.id}><div className="commercial-score"><strong>{String(result.overallScore ?? 0)}</strong><span>/100</span></div><div><h3>{String(listing.title ?? listing.property_name ?? (language==='zh'?'盘源':'Listing'))}</h3><p>{statusLabel(String(result.recommendationLevel ?? ''), language)}</p><div className="commercial-match-reasons"><span><Check size={14} />{t.strengths}: {array(result.matchedCriteria).slice(0, 3).map(value=>matchLabel(value,language)).join(', ') || '-'}</span><span>{t.gaps}: {array(result.missingCriteria).slice(0, 2).map(value=>matchLabel(value,language)).join(', ') || '-'}</span>{array(result.hardConflicts).length ? <span className="danger">{t.conflicts}: {array(result.hardConflicts).map(value=>matchLabel(value,language)).join(', ')}</span> : null}</div></div><div className="commercial-row-actions"><button title={language==='zh'?'入围':'Shortlist'} onClick={() => action(matchId, 'shortlist')}><Check size={17} /></button><button title={language==='zh'?'拒绝':'Reject'} onClick={() => action(matchId, 'reject')}><X size={17} /></button><button title={language==='zh'?'创建提案':'Create proposal'} onClick={() => action(matchId, 'proposal')}><ClipboardList size={17} /></button><button title={language==='zh'?'创建看房':'Create viewing'} onClick={() => action(matchId, 'viewing')}><CalendarClock size={17} /></button><button title={language==='zh'?'创建交易':'Create deal'} onClick={() => action(matchId, 'deal')}><Handshake size={17} /></button></div></article>; })}</div>}
  </section>;
}

function Deals({ rows, language, mode, setMode }: { rows: Row[]; language: Language; mode: 'kanban' | 'table'; setMode: (mode: 'kanban' | 'table') => void }) {
  const stages = ['enquiry','qualification','sourcing','proposal','viewing','shortlisted','negotiation','loi','due_diligence','tenancy_agreement','completed','lost'];
  return <section><div className="commercial-view-toggle"><button className={mode === 'kanban' ? 'active' : ''} onClick={() => setMode('kanban')}>{language === 'zh' ? '管道' : 'Pipeline'}</button><button className={mode === 'table' ? 'active' : ''} onClick={() => setMode('table')}>{language === 'zh' ? '列表' : 'Table'}</button></div>{mode === 'table' ? <RecordRows view="deals" rows={rows} language={language} /> : <div className="commercial-kanban">{stages.map((stage) => <section key={stage}><header><span>{statusLabel(stage, language)}</span><b>{rows.filter((row) => row.stage === stage).length}</b></header>{rows.filter((row) => row.stage === stage).map((row) => <Link href={`/commercial/deals/${row.id}`} key={row.id}><strong>{String(row.title)}</strong><small>{currency(Number(row.deal_value ?? 0))} · {String(row.probability ?? 0)}%</small><span>{row.next_follow_up ? date(row.next_follow_up) : '-'}</span></Link>)}</section>)}</div>}</section>;
}

function Followups({ rows, language, action }: { rows: Row[]; language: Language; action: (id: string, value: 'complete' | 'reschedule' | 'note' | 'assign') => void }) {
  const groups = [
    ['overdue',language === 'zh' ? '逾期' : 'Overdue'],['today',language === 'zh' ? '今天' : 'Due today'],['this_week',language === 'zh' ? '本周' : 'Due this week'],['inactive_7',language === 'zh' ? '七天无活动' : 'No activity for 7 days'],['inactive_14',language === 'zh' ? '十四天无活动' : 'No activity for 14 days'],['proposal_feedback',language === 'zh' ? '提案等待反馈' : 'Proposals awaiting feedback'],['viewing_feedback',language === 'zh' ? '看房等待反馈' : 'Viewings awaiting feedback'],['stalled_negotiation',language === 'zh' ? '停滞谈判' : 'Stalled negotiations'],['expiring_requirement',language === 'zh' ? '即将到期需求' : 'Expiring requirements'],['listing_reverification',language === 'zh' ? '盘源待重新验证' : 'Listings needing re-verification']
  ] as Array<[string,string]>;
  return <div className="commercial-followup-grid">{groups.map(([bucket,title]) => {const items=rows.filter(row=>row.bucket===bucket);return <section key={bucket}><header><h2>{title}</h2><span>{items.length}</span></header>{items.length ? items.map((row) => <article key={row.id}><div><strong>{String(row.title ?? statusLabel(String(row.follow_up_type??''),language))}</strong><small>{row.derived?followupLabel(String(row.bucket),language):String(row.note || '-')}</small></div><time>{dateTime(row.due_at)}</time>{row.derived?<Link className="commercial-secondary" href={String(row.source_href)}>{language==='zh'?'打开记录':'Open record'}</Link>:<div className="commercial-row-actions"><button title={language==='zh'?'完成':'Complete'} onClick={() => action(row.id, 'complete')}><Check size={16} /></button><button title={language==='zh'?'改期':'Reschedule'} onClick={() => action(row.id, 'reschedule')}><CalendarClock size={16} /></button><button title={language==='zh'?'添加备注':'Add note'} onClick={() => action(row.id, 'note')}><FileText size={16}/></button><button title={language==='zh'?'分配用户':'Assign user'} onClick={() => action(row.id, 'assign')}><UserRound size={16}/></button></div>}</article>) : <Empty language={language} compact />}</section>;})}</div>;
}

function Detail({ view, row, language, role }: { view: View; row?: Row; language: Language; role: string }) {
  if (!row) return <Empty language={language} />;
  const hidden = new Set(['id','workspace_id','created_by','deleted_at','metadata','photo_paths','document_paths']);
  const summary = Boolean(row.summary_only);
  return <><section className="commercial-detail"><div className="commercial-detail-title"><div><span>{recordIcon(view)}</span><div><p>{summary ? (language === 'zh' ? '受限摘要' : 'Restricted summary') : view}</p><h2>{primary(row, view)}</h2><small>{secondary(row, view)}</small></div></div><span className="commercial-status">{statusLabel(String(row.confidentiality_level ?? row.status ?? row.stage ?? ''), language)}</span></div>{summary && <div className="commercial-confidential-notice">{language === 'zh' ? '为保护机密信息，此摘要仅显示大概范围。地址、业主、坐标、照片、文件和内部备注不会发送到此页面。' : 'This controlled summary contains approximate ranges only. Address, owner, coordinates, media, documents, and internal notes were not sent to this page.'}</div>}<div className="commercial-detail-grid">{Object.entries(row).filter(([key, value]) => !hidden.has(key) && key !== 'summary_only' && value !== '' && value !== null && value !== undefined).map(([key, value]) => <div key={key}><span>{label(key)}</span><strong>{formatValue(key, value)}</strong></div>)}</div></section>{view === 'listings' && !summary && <MediaPanel listingId={row.id} language={language} role={role} />}{view === 'deals' && <><DealEditor row={row} language={language} role={role} /><ActivityTimeline entityType="deals" entityId={row.id} language={language}/></>}</>;
}

function ActivityTimeline({entityType,entityId,language}:{entityType:string;entityId:string;language:Language}){const[rows,setRows]=useState<Row[]>([]);useEffect(()=>{fetch(`/api/commercial/activities?entityType=${entityType}&entityId=${entityId}`,{cache:'no-store'}).then(response=>response.json()).then(result=>{if(result.success)setRows(result.rows);}).catch(()=>setRows([]));},[entityId,entityType]);return <section className="commercial-activity"><div className="commercial-section-head"><SectionTitle icon={CalendarClock} title={language==='zh'?'活动时间线':'Activity timeline'}/></div>{rows.length?rows.map(row=><article key={row.id}><span/><div><strong>{statusLabel(String(row.activity_type),language)}</strong><small>{dateTime(row.created_at)}</small></div></article>):<Empty language={language} compact/>}</section>}

function DealEditor({ row, language, role }: { row: Row; language: Language; role: string }) {
  const financeOnly = role === 'finance'; const canManage = ['owner','admin','manager','agent','finance'].includes(role); const [values,setValues]=useState({stage:String(row.stage),probability:String(row.probability??0),expected_commission:String(row.expected_commission??0),next_action:String(row.next_action??''),next_follow_up:String(row.next_follow_up??''),target_close_date:String(row.target_close_date??''),loss_reason:String(row.loss_reason??''),notes:String(row.notes??'')}); const [saving,setSaving]=useState(false); const [message,setMessage]=useState('');
  if(!canManage)return null; const stages=[String(row.stage),...nextDealStages(String(row.stage))];
  async function save(){setSaving(true);setMessage('');const payload:Row={id:row.id,probability:Number(values.probability),expected_commission:Number(values.expected_commission),notes:values.notes};if(!financeOnly)Object.assign(payload,{stage:values.stage,next_action:values.next_action,next_follow_up:values.next_follow_up||null,target_close_date:values.target_close_date||null,loss_reason:values.loss_reason});const response=await fetch('/api/commercial/deals',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();setSaving(false);if(!response.ok||!result.success){setMessage(language==='zh'?`无法保存：${result.technicalReference??'请求失败'}`:`Could not save: ${result.technicalReference??'request failed'}`);return;}setMessage(language==='zh'?'交易已更新。':'Deal updated.');window.setTimeout(()=>window.location.reload(),500);}
  return <section className="commercial-deal-editor">
    <div className="commercial-section-head"><SectionTitle icon={Handshake} title={language === 'zh' ? '交易控制' : 'Deal controls'} /><button className="commercial-primary" disabled={saving} onClick={() => void save()}>{saving ? '...' : language === 'zh' ? '保存更改' : 'Save changes'}</button></div>
    {message && <div className="commercial-notice">{message}</div>}
    <div className="commercial-form-grid">
      {!financeOnly && <>
        <label><span>{language === 'zh' ? '允许的下一阶段' : 'Permitted next stage'}</span><select value={values.stage} onChange={(event) => setValues({ ...values, stage: event.target.value })}>{stages.map((stage) => <option key={stage} value={stage}>{statusLabel(stage, language)}</option>)}</select></label>
        <label><span>{language === 'zh' ? '下一步行动' : 'Next action'}</span><input value={values.next_action} onChange={(event) => setValues({ ...values, next_action: event.target.value })} /></label>
        <label><span>{language === 'zh' ? '下次跟进' : 'Next follow-up'}</span><DateInput value={values.next_follow_up} onValueChange={(value) => setValues({ ...values, next_follow_up: value })} /></label>
        <label><span>{language === 'zh' ? '目标成交日期' : 'Target close date'}</span><DateInput value={values.target_close_date} onValueChange={(value) => setValues({ ...values, target_close_date: value })} /></label>
        <label className="wide"><span>{language === 'zh' ? '失败原因' : 'Loss reason'}</span><input value={values.loss_reason} onChange={(event) => setValues({ ...values, loss_reason: event.target.value })} /></label>
      </>}
      <label><span>{language === 'zh' ? '成交概率 %' : 'Probability %'}</span><input type="number" min="0" max="100" value={values.probability} onChange={(event) => setValues({ ...values, probability: event.target.value })} /></label>
      <label><span>{language === 'zh' ? '预计佣金' : 'Expected commission'}</span><input type="number" min="0" value={values.expected_commission} onChange={(event) => setValues({ ...values, expected_commission: event.target.value })} /></label>
      <label className="wide"><span>{language === 'zh' ? '备注' : 'Notes'}</span><textarea value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></label>
    </div>
  </section>;
}

type MediaRow = { id: string; media_type: string; display_name: string; mime_type: string; file_size: number; created_at: string };
function MediaPanel({ listingId, language, role }: { listingId: string; language: Language; role: string }) {
  const [media, setMedia] = useState<MediaRow[]>([]); const [urls, setUrls] = useState<Record<string,string>>({}); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [progress, setProgress] = useState(0); const [mediaType, setMediaType] = useState('property_photo'); const canManage = ['owner','admin','manager','agent'].includes(role);
  const loadMedia = useCallback(async () => { setLoading(true); setError(''); try { const response = await fetch(`/api/commercial/media?listingId=${listingId}`, { cache:'no-store' }); const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.error); setMedia(result.rows); const images = (result.rows as MediaRow[]).filter((item) => item.mime_type.startsWith('image/')); const signed = await Promise.all(images.map(async (item) => { const request = await fetch('/api/commercial/media/signed-url', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mediaId:item.id}) }); const data = await request.json(); return [item.id, request.ok ? data.signedUrl : ''] as const; })); setUrls(Object.fromEntries(signed)); } catch { setError(language === 'zh' ? '无法加载媒体。' : 'Media could not be loaded.'); } finally { setLoading(false); } }, [language, listingId]);
  useEffect(() => { void loadMedia(); }, [loadMedia]);
  function upload(file?: File) { if (!file) return; setError(''); setProgress(1); const form = new FormData(); form.set('file', file); form.set('listingId', listingId); form.set('mediaType', mediaType); const xhr = new XMLHttpRequest(); xhr.open('POST','/api/commercial/media'); xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.max(1, Math.round(event.loaded / event.total * 100))); }; xhr.onload = () => { setProgress(0); try { const result = JSON.parse(xhr.responseText); if (xhr.status < 200 || xhr.status >= 300 || !result.success) throw new Error(result.error); void loadMedia(); } catch { setError(language === 'zh' ? '上传失败。请检查文件类型和大小。' : 'Upload failed. Check the file type and size.'); } }; xhr.onerror = () => { setProgress(0); setError(language === 'zh' ? '上传连接失败。' : 'Upload connection failed.'); }; xhr.send(form); }
  async function openMedia(id: string, disposition: 'inline'|'attachment') { const response = await fetch('/api/commercial/media/signed-url', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mediaId:id, disposition}) }); const result = await response.json(); if (!response.ok || !result.success) { setError(language === 'zh' ? '无法创建安全链接。' : 'Secure link could not be created.'); return; } window.open(result.signedUrl, '_blank', 'noopener,noreferrer'); }
  async function remove(id: string) { if (!window.confirm(language === 'zh' ? '确定删除此文件？' : 'Delete this file?')) return; const response = await fetch('/api/commercial/media', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mediaId:id}) }); if (!response.ok) { setError(language === 'zh' ? '删除失败。' : 'Delete failed.'); return; } await loadMedia(); }
  return <section className="commercial-media"><div className="commercial-section-head"><SectionTitle icon={Image} title={language === 'zh' ? '私人媒体与文件' : 'Private media and documents'} />{canManage && <div className="commercial-media-upload"><select value={mediaType} onChange={(event) => setMediaType(event.target.value)}>{['property_photo','floor_plan','brochure','tenancy_document','authority_letter','site_plan','proposal_attachment'].map((type) => <option key={type} value={type}>{statusLabel(type, language)}</option>)}</select><label className="commercial-primary"><Upload size={16} />{language === 'zh' ? '上传' : 'Upload'}<input type="file" accept="image/jpeg,image/png,application/pdf,.docx" onChange={(event) => upload(event.target.files?.[0])} /></label></div>}</div>{progress > 0 && <div className="commercial-progress"><span style={{width:`${progress}%`}} /><b>{progress}%</b></div>}{error && <div className="commercial-form-error">{error}</div>}{loading ? <Loading text={language === 'zh' ? '正在加载私人媒体' : 'Loading private media'} /> : !media.length ? <Empty language={language} compact /> : <div className="commercial-media-grid">{media.map((item) => <article key={item.id}>{item.mime_type.startsWith('image/') && urls[item.id] ? <img src={urls[item.id]} alt={item.display_name} /> : <div className="commercial-document-icon"><FileText size={28} /></div>}<div><strong>{item.display_name}</strong><small>{statusLabel(item.media_type, language)} · {(item.file_size / 1024 / 1024).toFixed(1)} MB</small></div><div className="commercial-row-actions"><button title={language === 'zh' ? '预览' : 'Preview'} onClick={() => void openMedia(item.id,'inline')}><Eye size={16} /></button><button title={language === 'zh' ? '下载' : 'Download'} onClick={() => void openMedia(item.id,'attachment')}><Download size={16} /></button>{canManage && <button title={language === 'zh' ? '删除' : 'Delete'} onClick={() => void remove(item.id)}><Trash2 size={16} /></button>}</div></article>)}</div>}</section>;
}

function RecordForm({ resource, language, close, saved }: { resource: string; language: Language; close: () => void; saved: () => void }) {
  const fields = formFields(resource); const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map((field) => [field.key, field.type === 'checkbox' ? false : field.type === 'select' ? field.default ?? field.options?.[0] ?? '' : field.default ?? '']))); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(''); try { const payload = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value !== 'string' || value.trim() !== '').map(([key, value]) => [key, typeof value === 'string' && numericFields.has(key) ? Number(value) : arrayFields.has(key) ? String(value).split(',').map((item) => item.trim()).filter(Boolean) : value])); const apiResource = resource === 'leads' ? 'requirements' : resource; const response = await fetch(`/api/commercial/${apiResource}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.technicalReference ?? 'save-failed'); saved(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'save-failed'); } finally { setSaving(false); } }
  return <div className="commercial-modal" role="dialog" aria-modal="true"><form onSubmit={submit}><header><div><p>{language === 'zh' ? '新建商业记录' : 'New commercial record'}</p><h2>{resource}</h2></div><button type="button" onClick={close}><X size={18} /></button></header>{error && <div className="commercial-form-error">{error}</div>}<div className="commercial-form-grid">{fields.map((field) => <label key={field.key} className={field.wide ? 'wide' : ''}><span>{language === 'zh' ? field.zh : field.en}</span>{field.type === 'select' ? <select required={field.required} value={String(values[field.key])} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}>{field.options?.map((option) => <option key={option} value={option}>{statusLabel(option, language)}</option>)}</select> : field.type === 'checkbox' ? <input type="checkbox" checked={Boolean(values[field.key])} onChange={(event) => setValues({ ...values, [field.key]: event.target.checked })} /> : field.type === 'textarea' ? <textarea rows={3} value={String(values[field.key])} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} /> : field.type === 'date' ? <DateInput required={field.required} value={String(values[field.key])} onValueChange={(value) => setValues({ ...values, [field.key]: value })} /> : field.type === 'datetime-local' ? <DateTimeInput required={field.required} value={String(values[field.key])} onValueChange={(value) => setValues({ ...values, [field.key]: value })} /> : <input type={field.type ?? 'text'} required={field.required} min={field.type === 'number' ? 0 : undefined} value={String(values[field.key])} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />}</label>)}</div><footer><button type="button" className="commercial-secondary" onClick={close}>{copy[language].cancel}</button><button className="commercial-primary" disabled={saving}>{saving ? '...' : copy[language].save}</button></footer></form></div>;
}

type CsvResult = { preview: { headers: string[]; rows: Record<string,string>[]; errors: Array<{row:number;message:string}>; duplicates:number[] }; previewHash: string; validRowCount: number; invalidRowCount: number; errorReportCsv: string };
function CsvImportModal({ resource, language, close, completed }: { resource: string; language: Language; close: () => void; completed: (count: number) => void }) {
  const [csv, setCsv] = useState(''); const [sourceName, setSourceName] = useState(''); const [result, setResult] = useState<CsvResult | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function selectFile(file?: File) { if (!file) return; setResult(null); setError(''); if (file.size > 2 * 1024 * 1024) { setError(language === 'zh' ? 'CSV 文件不得超过 2 MB。' : 'CSV files must be 2 MB or smaller.'); return; } setSourceName(file.name); setCsv(await file.text()); }
  async function submit(confirm = false) { if (!csv) return; setBusy(true); setError(''); try { const response = await fetch('/api/commercial/csv', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({resource,csv,sourceName,confirm,previewHash:result?.previewHash}) }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error ?? 'import-failed'); if (data.importCommitted) completed(data.importedCount); else setResult(data); } catch (importError) { const code = importError instanceof Error ? importError.message : 'import-failed'; setError(language === 'zh' ? `导入未完成：${code}` : `Import was not completed: ${code}`); } finally { setBusy(false); } }
  function downloadErrors() { if (!result?.errorReportCsv) return; const url = URL.createObjectURL(new Blob([result.errorReportCsv], {type:'text/csv;charset=utf-8'})); const anchor = document.createElement('a'); anchor.href=url; anchor.download=`${resource}-import-errors.csv`; anchor.click(); URL.revokeObjectURL(url); }
  return <div className="commercial-modal" role="dialog" aria-modal="true"><section className="commercial-csv-modal"><header><div><p>{language === 'zh' ? '安全 CSV 导入' : 'Safe CSV import'}</p><h2>{label(resource)}</h2></div><button onClick={close}><X size={18} /></button></header><div className="commercial-csv-body"><label className="commercial-csv-drop"><Upload size={24} /><strong>{sourceName || (language === 'zh' ? '选择 CSV 文件' : 'Choose CSV file')}</strong><span>{language === 'zh' ? '重新选择文件可修正后再验证。不会覆盖现有记录。' : 'Choose the corrected file again to revalidate. Existing records are never overwritten.'}</span><input type="file" accept=".csv,text/csv" onChange={(event) => void selectFile(event.target.files?.[0])} /></label>{error && <div className="commercial-form-error">{error}</div>}{result && <><div className="commercial-csv-summary"><div><span>{language === 'zh' ? '有效行' : 'Valid rows'}</span><strong>{result.validRowCount}</strong></div><div><span>{language === 'zh' ? '无效行' : 'Invalid rows'}</span><strong>{result.invalidRowCount}</strong></div><div><span>{language === 'zh' ? '重复行' : 'Duplicates'}</span><strong>{result.preview.duplicates.length}</strong></div></div>{result.preview.errors.length > 0 && <div className="commercial-csv-errors">{result.preview.errors.slice(0,20).map((item,index) => <p key={`${item.row}-${index}`}><b>{language === 'zh' ? '行' : 'Row'} {item.row}</b>{csvErrorLabel(item.message,language)}</p>)}</div>}<div className="commercial-csv-preview"><table><thead><tr><th>#</th>{result.preview.headers.slice(0,6).map((header) => <th key={header}>{label(header)}</th>)}</tr></thead><tbody>{result.preview.rows.slice(0,20).map((row) => <tr key={row.__rowNumber}><td>{row.__rowNumber}</td>{result.preview.headers.slice(0,6).map((header) => <td key={header}>{row[header]}</td>)}</tr>)}</tbody></table></div></>}</div><footer><button className="commercial-secondary" onClick={close}>{copy[language].cancel}</button>{result?.errorReportCsv && <button className="commercial-secondary" onClick={downloadErrors}><Download size={16} />{language === 'zh' ? '错误报告' : 'Error report'}</button>}{!result ? <button className="commercial-primary" disabled={!csv || busy} onClick={() => void submit(false)}>{busy ? '...' : language === 'zh' ? '验证并预览' : 'Validate and preview'}</button> : <button className="commercial-primary" disabled={!result.validRowCount || busy} onClick={() => void submit(true)}>{busy ? '...' : language === 'zh' ? '确认导入有效行' : 'Confirm valid rows'}</button>}</footer></section></div>;
}

type Field = { key: string; en: string; zh: string; type?: string; required?: boolean; wide?: boolean; default?: string; options?: string[] };
function formFields(resource: string): Field[] {
  const common: Record<string, Field[]> = {
    companies: [{ key:'legal_name',en:'Legal name',zh:'公司法定名称',required:true },{ key:'registration_number',en:'Registration number',zh:'公司注册号' },{ key:'business_category',en:'Business category',zh:'业务类别',type:'select',options:['f&b','restaurant','cafe','retail','fashion','beauty','wellness','education','medical','automotive','showroom','office','logistics','warehouse','hotel','entertainment','supermarket','convenience_store','other'] },{ key:'country',en:'Country',zh:'国家',default:'Malaysia' },{ key:'headquarters',en:'Headquarters',zh:'总部' },{ key:'expansion_status',en:'Expansion status',zh:'扩张状态' },{ key:'target_cities',en:'Target cities (comma-separated)',zh:'目标城市（逗号分隔）',wide:true },{ key:'source',en:'Source',zh:'来源' },{ key:'notes',en:'Notes',zh:'备注',type:'textarea',wide:true }],
    contacts: [{ key:'company_id',en:'Company ID',zh:'公司编号',required:true },{ key:'full_name',en:'Full name',zh:'姓名',required:true },{ key:'job_title',en:'Job title',zh:'职位' },{ key:'department',en:'Department',zh:'部门' },{ key:'phone',en:'Phone',zh:'电话' },{ key:'whatsapp_number',en:'WhatsApp',zh:'WhatsApp' },{ key:'email',en:'Email',zh:'电邮',type:'email' },{ key:'preferred_language',en:'Preferred language',zh:'首选语言',type:'select',options:['en','zh','bilingual'] },{ key:'decision_maker_level',en:'Decision level',zh:'决策者级别',type:'select',options:['final_decision_maker','key_influencer','operations','expansion_manager','franchise_manager','finance','legal','assistant','broker','unknown'] },{ key:'next_follow_up',en:'Next follow-up',zh:'下次跟进',type:'date' },{ key:'notes',en:'Notes',zh:'备注',type:'textarea',wide:true }],
    requirements: [{ key:'title',en:'Requirement title',zh:'需求标题',required:true,wide:true },{ key:'company_id',en:'Company ID',zh:'公司编号' },{ key:'requirement_type',en:'Requirement type',zh:'需求类型',type:'select',options:['retail','restaurant','cafe','showroom','commercial_bungalow','office','warehouse','industrial','land','mall_lot','shoplot','hotel','mixed_use','other'] },{ key:'transaction_type',en:'Transaction',zh:'交易类型',type:'select',options:['rent','sale','either'] },{ key:'preferred_locations',en:'Preferred locations',zh:'首选地点',wide:true },{ key:'excluded_locations',en:'Excluded locations',zh:'排除地点',wide:true },{ key:'min_built_up',en:'Minimum built-up (sq ft)',zh:'最低建筑面积',type:'number' },{ key:'max_built_up',en:'Maximum built-up (sq ft)',zh:'最高建筑面积',type:'number' },{ key:'max_rental',en:'Maximum rental (RM)',zh:'最高租金',type:'number' },{ key:'ground_floor_required',en:'Ground floor required',zh:'必须底层',type:'checkbox' },{ key:'three_phase_required',en:'Three-phase required',zh:'需要三相电',type:'checkbox' },{ key:'exhaust_required',en:'Exhaust required',zh:'需要排气系统',type:'checkbox' },{ key:'grease_trap_required',en:'Grease trap required',zh:'需要隔油池',type:'checkbox' },{ key:'urgency',en:'Urgency',zh:'紧急程度',type:'select',options:['immediate','within_30_days','within_60_days','within_90_days','exploratory'] },{ key:'status',en:'Status',zh:'状态',type:'select',options:['new_enquiry','qualified','sourcing','proposal_prepared','proposed','viewing_arranged','viewed','shortlisted','negotiation','loi','tenancy_agreement','sale_and_purchase','completed','paused','lost','cancelled'] },{ key:'notes',en:'Notes',zh:'备注',type:'textarea',wide:true }],
    listings: [{ key:'title',en:'Listing title',zh:'盘源标题',required:true,wide:true },{ key:'property_name',en:'Property name',zh:'物业名称' },{ key:'property_type',en:'Property type',zh:'物业类型',required:true },{ key:'transaction_type',en:'Transaction',zh:'交易类型',type:'select',options:['rent','sale','either'] },{ key:'state',en:'State',zh:'州属' },{ key:'city',en:'City',zh:'城市' },{ key:'area',en:'Area',zh:'地区' },{ key:'address',en:'Exact address',zh:'详细地址',wide:true },{ key:'concealed_address',en:'Concealed address',zh:'隐藏地址',wide:true },{ key:'built_up',en:'Built-up (sq ft)',zh:'建筑面积',type:'number' },{ key:'asking_rental',en:'Asking rental (RM)',zh:'出租价',type:'number' },{ key:'asking_sale_price',en:'Asking sale price (RM)',zh:'售价',type:'number' },{ key:'ground_floor',en:'Ground floor',zh:'底层',type:'checkbox' },{ key:'three_phase_electricity',en:'Three-phase electricity',zh:'三相电',type:'checkbox' },{ key:'exhaust',en:'Exhaust',zh:'排气系统',type:'checkbox' },{ key:'grease_trap',en:'Grease trap',zh:'隔油池',type:'checkbox' },{ key:'commercial_zoning',en:'Commercial zoning',zh:'商业用途分区',type:'checkbox' },{ key:'confidentiality_level',en:'Confidentiality',zh:'保密级别',type:'select',options:['normal','internal_only','restricted','highly_confidential'] },{ key:'status',en:'Status',zh:'状态',type:'select',options:['draft','active','under_offer','reserved','rented','sold','temporarily_unavailable','expired','archived'] },{ key:'notes',en:'Notes',zh:'备注',type:'textarea',wide:true }],
    deals: [{ key:'title',en:'Deal title',zh:'交易标题',required:true,wide:true },{ key:'company_id',en:'Company ID',zh:'公司编号' },{ key:'requirement_id',en:'Requirement ID',zh:'需求编号' },{ key:'listing_id',en:'Listing ID',zh:'盘源编号' },{ key:'deal_value',en:'Deal value (RM)',zh:'交易价值',type:'number' },{ key:'expected_commission',en:'Expected commission (RM)',zh:'预计佣金',type:'number' },{ key:'commission_share',en:'Commission share (%)',zh:'佣金比例',type:'number',default:'100' },{ key:'stage',en:'Stage',zh:'阶段',type:'select',options:['enquiry','qualification','sourcing','proposal','viewing','shortlisted','negotiation','loi','due_diligence','tenancy_agreement','spa','deposit_paid','handover','completed','lost','cancelled'] },{ key:'probability',en:'Probability (%)',zh:'成交概率',type:'number',default:'10' },{ key:'next_action',en:'Next action',zh:'下一步行动',wide:true },{ key:'next_follow_up',en:'Next follow-up',zh:'下次跟进',type:'date' },{ key:'notes',en:'Notes',zh:'备注',type:'textarea',wide:true }],
    followups: [{ key:'follow_up_type',en:'Follow-up type',zh:'跟进类型',type:'select',options:['call','whatsapp_draft','email_draft','proposal_feedback','viewing_feedback','listing_verification'] },{ key:'due_at',en:'Due date and time',zh:'到期日期时间',type:'datetime-local',required:true },{ key:'priority',en:'Priority',zh:'优先级',type:'select',options:['low','normal','high','urgent'] },{ key:'company_id',en:'Company ID',zh:'公司编号' },{ key:'contact_id',en:'Contact ID',zh:'联系人编号' },{ key:'requirement_id',en:'Requirement ID',zh:'需求编号' },{ key:'listing_id',en:'Listing ID',zh:'盘源编号' },{ key:'deal_id',en:'Deal ID',zh:'交易编号' },{ key:'proposal_id',en:'Proposal ID',zh:'提案编号' },{ key:'viewing_id',en:'Viewing ID',zh:'看房编号' },{ key:'assigned_user_id',en:'Assigned user ID',zh:'分配用户编号' },{ key:'note',en:'Note',zh:'备注',type:'textarea',wide:true },{ key:'draft_text',en:'Message draft',zh:'信息草稿',type:'textarea',wide:true }],
    leads: [{ key:'title',en:'Client / requirement title',zh:'客户/需求标题',required:true,wide:true },{ key:'requirement_type',en:'Business type',zh:'业务类别',type:'select',options:['f&b','restaurant','cafe','retail','fashion','beauty','wellness','education','medical','automotive','showroom','office','warehouse','industrial','other'] },{ key:'preferred_locations',en:'Preferred area (comma-separated)',zh:'首选地区（逗号分隔）',wide:true },{ key:'max_rental',en:'Max budget / rental (RM)',zh:'最高预算（租金）',type:'number' },{ key:'urgency',en:'Timeline',zh:'时间线',type:'select',options:['immediate','within_30_days','within_60_days','within_90_days','exploratory'],default:'exploratory' },{ key:'next_follow_up',en:'Next follow-up',zh:'下次跟进',type:'date' },{ key:'notes',en:'Notes',zh:'备注',type:'textarea',wide:true }]
  };
  return common[resource] ?? [];
}

const LEAD_STAGES: Array<{ key: string; en: string; zh: string; statuses: Set<string>; next: string }> = [
  { key: 'new_lead',    en: 'New Lead',      zh: '新线索',    statuses: new Set(['new_enquiry']),                                                                        next: 'qualified' },
  { key: 'contacted',   en: 'Contacted',     zh: '已联系',    statuses: new Set(['qualified']),                                                                          next: 'viewing_arranged' },
  { key: 'viewing',     en: 'Viewing',       zh: '看房中',    statuses: new Set(['sourcing','proposal_prepared','proposed','viewing_arranged','viewed']),                  next: 'negotiation' },
  { key: 'negotiation', en: 'Negotiation',   zh: '谈判中',    statuses: new Set(['shortlisted','negotiation','loi','tenancy_agreement','sale_and_purchase']),             next: 'completed' },
  { key: 'closed',      en: 'Closed / Lost', zh: '成交/丢单', statuses: new Set(['completed','paused','lost','cancelled']),                                              next: '' },
];

function LeadPipeline({ rows, language, onAdvance }: { rows: Row[]; language: Language; onAdvance: (id: string, status: string) => void }) {
  function stageOf(status: string) { return LEAD_STAGES.find((s) => s.statuses.has(status))?.key ?? 'new_lead'; }
  return (
    <div className="commercial-kanban">
      {LEAD_STAGES.map((stage) => {
        const cards = rows.filter((r) => stageOf(String(r.status ?? '')) === stage.key);
        return (
          <section key={stage.key}>
            <header><span>{language === 'zh' ? stage.zh : stage.en}</span><b>{cards.length}</b></header>
            {!cards.length && <p style={{ fontSize: 12, color: '#64748b', padding: '6px 0' }}>{language === 'zh' ? '暂无线索' : 'No leads'}</p>}
            {cards.map((row) => (
              <article key={row.id}>
                <Link href={`/commercial/requirements/${row.id}`} style={{ display: 'block', marginBottom: 8 }}>
                  <strong style={{ display: 'block', fontSize: 13 }}>{String(row.title ?? '-')}</strong>
                  <small style={{ display: 'block', marginTop: 4, color: '#7c8a9a', fontSize: 12 }}>
                    {String(row.requirement_type ?? '').replaceAll('_', ' ')}{array(row.preferred_locations).length ? ` · ${array(row.preferred_locations).slice(0, 2).join(', ')}` : ''}
                  </small>
                  {row.max_rental ? <small style={{ display: 'block', marginTop: 3, color: '#67e8f9', fontSize: 12 }}>{currency(Number(row.max_rental))} max</small> : null}
                </Link>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {stage.next && <button className="commercial-secondary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => onAdvance(row.id, stage.next)}>{language === 'zh' ? '推进 →' : 'Advance →'}</button>}
                  {stage.key === 'negotiation' && <button className="commercial-secondary" style={{ fontSize: 11, padding: '3px 10px', color: '#fca5a5', borderColor: 'rgba(252,165,165,0.3)' }} onClick={() => onAdvance(row.id, 'lost')}>{language === 'zh' ? '丢单' : 'Mark Lost'}</button>}
                </div>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

const numericFields = new Set(['min_built_up','max_built_up','max_rental','built_up','asking_rental','asking_sale_price','deal_value','expected_commission','commission_share','probability']);
const arrayFields = new Set(['target_cities','preferred_locations','excluded_locations']);
function SectionTitle({ icon: Icon, title }: { icon: typeof Store; title: string }) { return <div className="commercial-section-title"><Icon size={17} /><h2>{title}</h2></div>; }
function Loading({ text }: { text: string }) { return <div className="commercial-loading"><div /><div /><div /><span>{text}</span></div>; }
function ErrorState({ text, retry, label }: { text: string; retry: () => void; label: string }) { return <div className="commercial-empty"><CircleDollarSign size={28} /><h2>{text}</h2><button className="commercial-primary" onClick={retry}>{label}</button></div>; }
function Empty({ language, compact = false }: { language: Language; compact?: boolean }) { return <div className={`commercial-empty ${compact ? 'compact' : ''}`}><Store size={compact ? 20 : 30} /><h2>{copy[language].empty}</h2>{!compact && <p>{copy[language].emptyBody}</p>}</div>; }
function recordIcon(view: View) { return view === 'companies' ? 'CO' : view === 'contacts' ? 'DM' : view === 'requirements' ? 'RQ' : view === 'listings' ? 'LS' : view === 'deals' ? 'DL' : view === 'matches' ? 'AI' : 'FU'; }
function primary(row: Row, view: View) { return String(row.legal_name ?? row.full_name ?? row.title ?? row.property_name ?? row.follow_up_type ?? `${view} record`); }
function secondary(row: Row, view: View) { if (view === 'listings') return `${row.area ?? row.city ?? '-'} · ${row.built_up ? `${row.built_up} sq ft` : '-'} · ${currency(Number(row.asking_rental ?? row.asking_sale_price ?? 0))}`; if (view === 'requirements') return `${String(row.requirement_type ?? '').replaceAll('_',' ')} · ${array(row.preferred_locations).join(', ') || '-'}`; if (view === 'deals') return `${currency(Number(row.deal_value ?? 0))} · ${row.probability ?? 0}%`; if (view === 'matches') return `${row.overall_score ?? 0}/100`; return String(row.business_category ?? row.job_title ?? row.note ?? row.source ?? ''); }
function detailHref(view: View, id: string) { return ['companies','requirements','listings','deals'].includes(view) ? `/commercial/${view}/${id}` : `/commercial/${view}`; }
function label(value: string) { return value.replaceAll('_',' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
function statusLabel(value: string, language: Language) { const normalized = value.replaceAll('_',' '); const zh: Record<string,string> = { active:'有效',draft:'草稿',normal:'普通',internal_only:'仅内部',restricted:'受限',highly_confidential:'高度机密',excellent_match:'优秀配对',strong_match:'强力配对',possible_match:'可能配对',weak_match:'较弱配对',unsuitable:'不适合',enquiry:'查询',qualification:'资格审核',sourcing:'寻找盘源',proposal:'提案',viewing:'看房',shortlisted:'入围',negotiation:'谈判',completed:'已完成',lost:'已失去',cancelled:'已取消',new_enquiry:'新咨询',property_photo:'物业照片',floor_plan:'平面图',brochure:'宣传册',tenancy_document:'租赁文件',authority_letter:'授权书',site_plan:'场地规划',proposal_attachment:'提案附件',call:'电话',whatsapp_draft:'WhatsApp 草稿',email_draft:'电邮草稿',proposal_feedback:'提案反馈',viewing_feedback:'看房反馈',listing_verification:'盘源验证',deals_stage_changed:'交易阶段已更改',deals_created:'交易已创建',deals_updated:'交易已更新' }; return language === 'zh' ? zh[value] ?? normalized : label(value); }
function matchLabel(value:string,language:Language){if(language==='en')return value;const zh:Record<string,string>={'Preferred location':'首选地点','Size range':'面积范围','Budget':'预算','Property type':'物业类型','Ground floor':'底层','Loading bay':'装卸区','Three-phase electricity':'三相电','Exhaust':'排气系统','Grease trap':'隔油池','Gas':'燃气','Water':'供水','Outdoor area':'户外区域','Swimming pool':'游泳池','Availability':'可用时间','Commercial zoning':'商业用途分区','Commercial exposure':'商业曝光','Built-up area':'建筑面积','Comparable budget':'可比较预算','Availability timing':'可用时间','Excluded location':'排除地点','Insufficient minimum size':'面积低于最低要求','Impossible budget':'超出最高预算','Wrong transaction type':'交易类型不符','Business use is prohibited':'禁止该商业用途','Listing unavailable':'盘源不可用','Commercial use not permitted':'不允许商业用途','Required Three-phase electricity absent':'缺少必需的三相电','Required Exhaust absent':'缺少必需的排气系统','Required Grease trap absent':'缺少必需的隔油池'};return zh[value]??value;}
function followupLabel(bucket:string,language:Language){if(language==='en')return ({inactive_7:'No activity for at least 7 days',inactive_14:'No activity for at least 14 days',proposal_feedback:'Proposal response is outstanding',viewing_feedback:'Viewing feedback is outstanding',stalled_negotiation:'Negotiation has stalled',expiring_requirement:'Requirement expires within 30 days',listing_reverification:'Listing verification is due'} as Record<string,string>)[bucket]??bucket;return ({inactive_7:'至少七天没有活动',inactive_14:'至少十四天没有活动',proposal_feedback:'提案尚未收到回复',viewing_feedback:'看房反馈尚未完成',stalled_negotiation:'谈判已停滞',expiring_requirement:'需求将在三十天内到期',listing_reverification:'盘源需要重新验证'} as Record<string,string>)[bucket]??bucket;}
function csvErrorLabel(value:string,language:Language){if(language==='en')return value.replaceAll(':',': ').replaceAll('-',' ');const [code,field]=value.split(':');const labels:Record<string,string>={'missing-column':'缺少列','required':'必填字段','duplicate-column':'重复列','row-limit-exceeded':'超过行数限制','invalid-number':'无效数字','invalid-id':'无效编号','invalid-value':'无效值','invalid-range':'无效范围','duplicate-existing-record':'现有记录重复','invalid-reference':'关联记录无效'};return `${labels[code]??value}${field?`：${label(field)}`:''}`;}
function formatValue(key: string, value: unknown) { if (Array.isArray(value)) return value.join(', ') || '-'; if (key.includes('date') || key.endsWith('_at')) return dateTime(value); if (key.includes('rental') || key.includes('price') || key.includes('value') || key.includes('commission')) return currency(value); if (typeof value === 'boolean') return value ? 'Yes / 是' : 'No / 否'; return String(value); }
function currency(value: unknown) { return formatMYR(value, '-'); }
function date(value: unknown) { return formatNexoraDate(value, '-'); }
function dateTime(value: unknown) { return formatNexoraDateTime(value, '-'); }
function array(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }
