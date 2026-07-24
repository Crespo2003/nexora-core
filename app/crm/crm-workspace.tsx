'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Columns3, LayoutList, Plus, RefreshCw, Search, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import { usePortalLanguage } from '../components/usePortalLanguage';
import { crmEnumLabel, getCrmCopy } from '../../lib/i18n/crm';
import { availableCrmStageTransitions, crmStageLabel, CRM_PIPELINE_STAGES, crmStageTone, type CrmPipelineStage } from '../../lib/crm/pipeline';
import type { WorkspaceRole } from '../../lib/rbac/permissions';

type Contact = { id: string; full_name?: string; company_name?: string; phone_original?: string; email?: string; client_type?: string };
type Enquiry = {
  id: string; enquiry_number: string; contact?: Contact | null; transaction_type: string; property_type?: string;
  preferred_areas?: string[]; budget_min?: number | null; budget_max?: number | null; priority: string;
  stage: CrmPipelineStage; assigned_user_id?: string | null; notes?: string; updated_at: string;
};
type ListPayload = { success: boolean; rows: Enquiry[]; count: number; page: number; pageSize: number; role: WorkspaceRole; userId: string; error?: string };
type DetailPayload = { success: boolean; record: Enquiry & { contact: Contact }; matches: Record<string, unknown>[]; appointments: Record<string, unknown>[]; followUps: Record<string, unknown>[]; deals: Record<string, unknown>[]; stages: Array<{ id: string; from_stage?: string | null; to_stage: CrmPipelineStage; created_at: string }>; activities: Array<{ id: string; activity_type: string; created_at: string }>; role: WorkspaceRole; userId: string };

function displayName(contact?: Contact | null) { return contact?.full_name || contact?.company_name || '—'; }
function formatDate(value: string, language: 'en' | 'zh') {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function formatMoney(value?: number | null) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(value);
}

export default function CrmWorkspace({ initialRole }: { initialRole: WorkspaceRole }) {
  const language = usePortalLanguage();
  const c = getCrmCopy(language);
  const [rows, setRows] = useState<Enquiry[]>([]);
  const [role, setRole] = useState<WorkspaceRole>(initialRole);
  const [userId, setUserId] = useState('');
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('');
  const [priority, setPriority] = useState('');
  const [view, setView] = useState<'table' | 'pipeline'>('table');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const [dealContacts, setDealContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);

  const canWrite = ['owner', 'admin', 'agent'].includes(role);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (query.trim()) params.set('q', query.trim());
    if (stage) params.set('stage', stage);
    if (priority) params.set('priority', priority);
    try {
      const response = await fetch(`/api/crm/enquiries?${params}`, { cache: 'no-store' });
      const payload = await response.json() as ListPayload;
      if (!response.ok || !payload.success) throw new Error(payload.error || 'request-failed');
      setRows(payload.rows); setCount(payload.count); setRole(payload.role); setUserId(payload.userId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'request-failed'); }
    finally { setLoading(false); }
  }, [page, priority, query, stage]);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id); setDetail(null);
    const response = await fetch(`/api/crm/enquiries/${id}`, { cache: 'no-store' });
    const payload = await response.json() as DetailPayload;
    if (response.ok && payload.success) setDetail(payload);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setQuery(searchInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action === 'new-enquiry') setCreateOpen(true);
    if (params.get('view') === 'pipeline') setView('pipeline');
    if (action === 'new-deal') {
      void fetch('/api/crm/context', { cache: 'no-store' }).then((response) => response.json()).then((payload: { contacts?: Contact[] }) => {
        setDealContacts(payload.contacts ?? []);
        setDealOpen(true);
      });
    }
    if (action === 'new-follow-up') {
      void fetch('/api/crm/context', { cache: 'no-store' }).then((response) => response.json()).then(async (payload: { enquiries?: Array<{ id: string; enquiry_number: string; contact_id: string }> }) => {
        const enquiries = payload.enquiries ?? [];
        if (!enquiries.length) { setError(language === 'zh' ? '请先创建询盘。' : 'Create an enquiry before adding a follow-up.'); return; }
        const choices = enquiries.slice(0, 20).map((item, index) => `${index + 1}. ${item.enquiry_number}`).join('\n');
        const choice = Number(window.prompt(`${language === 'zh' ? '选择询盘' : 'Choose enquiry'}\n${choices}`));
        const enquiry = enquiries[choice - 1];
        if (!enquiry) return;
        const title = window.prompt(language === 'zh' ? '跟进标题' : 'Follow-up title');
        const dueAt = window.prompt(language === 'zh' ? '到期日期时间' : 'Due date and time');
        if (title && dueAt) await fetch('/api/crm/follow-ups', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ title, dueAt, enquiryId:enquiry.id, contactId:enquiry.contact_id }) });
      });
    }
    const enquiry = params.get('enquiry');
    if (enquiry) void loadDetail(enquiry);
  }, [loadDetail]);

  async function submitEnquiry(event: React.FormEvent<HTMLFormElement>, confirmDuplicate = false) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      fullName: form.get('fullName'), companyName: form.get('companyName'), phone: form.get('phone'), email: form.get('email'),
      clientType: form.get('clientType'), transactionType: form.get('transactionType'), propertyType: form.get('propertyType'),
      preferredAreas: form.get('preferredAreas'), budgetMin: form.get('budgetMin'), budgetMax: form.get('budgetMax'),
      bedroomsMin: form.get('bedroomsMin'), bathroomsMin: form.get('bathroomsMin'), sizeMin: form.get('sizeMin'), sizeMax: form.get('sizeMax'),
      furnishing: form.get('furnishing'), moveInDate: form.get('moveInDate'), commercialRequirements: form.get('commercialRequirements'),
      nationality: form.get('nationality'), parkingRequirement: form.get('parkingRequirement'), petRequirement: form.get('petRequirement'),
      specialRequirements: form.get('specialRequirements'),
      source: form.get('source'), priority: form.get('priority'), notes: form.get('notes'), nextFollowUpAt: form.get('nextFollowUpAt'),
      confirmDuplicate,
    };
    const response = await fetch('/api/crm/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json() as { success?: boolean; duplicateWarning?: boolean };
    if (response.status === 409 && result.duplicateWarning) { setDuplicate(true); setSaving(false); return; }
    if (response.ok && result.success) { setCreateOpen(false); setDuplicate(false); (event.currentTarget as HTMLFormElement).reset(); void load(); }
    else setError('request-failed');
    setSaving(false);
  }

  async function updateEnquiry(payload: Record<string, unknown>) {
    if (!selectedId) return;
    setSaving(true);
    const response = await fetch('/api/crm/enquiries', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selectedId, ...payload }) });
    if (response.ok) { await Promise.all([load(), loadDetail(selectedId)]); } else setError('request-failed');
    setSaving(false);
  }

  async function submitDeal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch('/api/crm/deals', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (response.ok) { setDealOpen(false); setView('pipeline'); } else setError('request-failed');
    setSaving(false);
  }

  function advance() {
    if (!detail) return;
    const options = availableCrmStageTransitions(detail.record.stage).filter((value) => value !== 'LOST');
    if (options[0]) void updateEnquiry({ stage: options[0] });
  }
  function markLost() {
    const reason = window.prompt(language === 'zh' ? '请输入流失原因' : 'Reason this opportunity was lost');
    if (reason) void updateEnquiry({ stage: 'LOST', lostReason: reason });
  }
  function convertDeal() {
    const title = window.prompt(language === 'zh' ? '交易标题' : 'Deal title', displayName(detail?.record.contact));
    if (title) void updateEnquiry({ action: 'convert-to-deal', title });
  }
  function editEnquiry() {
    if (!detail) return;
    const propertyType = window.prompt(c.propertyType, detail.record.property_type || '');
    if (propertyType === null) return;
    const notes = window.prompt(c.notes, detail.record.notes || '');
    if (notes === null) return;
    void updateEnquiry({ property_type: propertyType, notes });
  }
  async function reassign() {
    const response = await fetch('/api/crm/context', { cache: 'no-store' });
    const payload = await response.json() as { members?: Array<{ user_id: string; role: string; profiles?: { full_name?: string; email?: string } | null }> };
    const members = payload.members ?? [];
    if (!members.length) return;
    const choices = members.map((member, index) => `${index + 1}. ${member.profiles?.full_name || member.profiles?.email || member.user_id} (${member.role})`).join('\n');
    const choice = Number(window.prompt(`${language === 'zh' ? '选择负责人' : 'Choose assignee'}\n${choices}`));
    if (Number.isInteger(choice) && members[choice - 1]) void updateEnquiry({ assigned_user_id: members[choice - 1].user_id });
  }

  const grouped = useMemo(() => CRM_PIPELINE_STAGES.map((key) => ({ key, rows: rows.filter((row) => row.stage === key) })), [rows]);

  return (
    <main className="command-shell crm-shell">
      <header className="command-header crm-header">
        <div><p className="eyebrow">NEXORA CORE</p><h1>{c.crmTitle}</h1><p className="header-copy">{c.crmSubtitle}</p></div>
        <AppNav activePage="crm">
          {canWrite && <button type="button" className="crm-primary" onClick={() => setCreateOpen(true)}><Plus size={16} />{c.newEnquiry}</button>}
        </AppNav>
      </header>

      <section className="crm-toolbar" aria-label={c.actions}>
        <label className="crm-search"><Search size={16} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={c.search} /></label>
        <select value={stage} onChange={(event) => { setStage(event.target.value); setPage(1); }} aria-label={c.stage}><option value="">{c.allStages}</option>{CRM_PIPELINE_STAGES.map((value) => <option key={value} value={value}>{crmStageLabel(value, language)}</option>)}</select>
        <select value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1); }} aria-label={c.priority}><option value="">{c.allPriorities}</option>{['hot','warm','normal','low'].map((value) => <option key={value} value={value}>{crmEnumLabel(value, language)}</option>)}</select>
        <div className="crm-view-toggle">
          <button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}><LayoutList size={15} />{c.table}</button>
          <button type="button" className={view === 'pipeline' ? 'active' : ''} onClick={() => setView('pipeline')}><Columns3 size={15} />{c.pipeline}</button>
        </div>
        <button type="button" className="crm-icon-button" onClick={() => void load()} aria-label={c.refresh}><RefreshCw size={16} /></button>
      </section>

      {!canWrite && <div className="crm-read-only" role="status">{c.readOnly}</div>}
      {error && <div className="crm-alert" role="alert">{c.unavailable}</div>}
      {loading ? <div className="crm-state">{c.loading}</div> : rows.length === 0 ? <div className="crm-state"><strong>{c.emptyEnquiries}</strong>{canWrite && <button className="crm-primary" onClick={() => setCreateOpen(true)}>{c.newEnquiry}</button>}</div> : view === 'table' ? (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead><tr><th>{c.enquiry}</th><th>{c.client}</th><th>{c.requirement}</th><th>{c.budget}</th><th>{c.stage}</th><th>{c.priority}</th><th>{c.updated}</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} tabIndex={0} onClick={() => void loadDetail(row.id)} onKeyDown={(event) => { if (event.key === 'Enter') void loadDetail(row.id); }}>
              <td><strong>{row.enquiry_number}</strong><small>{crmEnumLabel(row.transaction_type, language)}</small></td>
              <td><strong>{displayName(row.contact)}</strong><small>{row.contact?.phone_original || row.contact?.email || '—'}</small></td>
              <td>{row.property_type || '—'}<small>{row.preferred_areas?.join(', ') || '—'}</small></td>
              <td>{formatMoney(row.budget_min)}<small>{row.budget_max ? `– ${formatMoney(row.budget_max)}` : ''}</small></td>
              <td><span className={`crm-badge ${crmStageTone(row.stage)}`}>{crmStageLabel(row.stage, language)}</span></td>
              <td><span className={`crm-priority ${row.priority}`}>{crmEnumLabel(row.priority, language)}</span></td>
              <td>{formatDate(row.updated_at, language)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="crm-kanban">
          {grouped.map((group) => <section className="crm-kanban-column" key={group.key}><header><span className={`crm-badge ${crmStageTone(group.key)}`}>{crmStageLabel(group.key, language)}</span><strong>{group.rows.length}</strong></header>
            {group.rows.length === 0 ? <div className="crm-kanban-empty">—</div> : group.rows.map((row) => <button type="button" className="crm-kanban-card" key={row.id} onClick={() => void loadDetail(row.id)}><strong>{displayName(row.contact)}</strong><span>{row.enquiry_number}</span><small>{row.property_type || row.transaction_type}</small></button>)}
          </section>)}
        </div>
      )}
      <footer className="crm-pagination"><span>{count} {c.enquiry.toLowerCase()}</span><div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{c.previous}</button><span>{page}</span><button disabled={page * 25 >= count} onClick={() => setPage((value) => value + 1)}>{c.next}</button></div></footer>

      {createOpen && <div className="crm-modal" role="dialog" aria-modal="true" aria-labelledby="new-enquiry-title">
        <form onSubmit={(event) => void submitEnquiry(event)} data-crm-enquiry-form>
          <header><div><p className="eyebrow">CRM</p><h2 id="new-enquiry-title">{c.newEnquiry}</h2></div><button type="button" onClick={() => { setCreateOpen(false); setDuplicate(false); }} aria-label={c.close}><X /></button></header>
          {duplicate && <div className="crm-duplicate" role="alert"><strong>{c.possibleDuplicate}</strong><span>{c.reuseDuplicate}</span></div>}
          <div className="crm-form-grid">
            <Field label={c.fullName}><input name="fullName" required /></Field>
            <Field label={c.companyName}><input name="companyName" /></Field>
            <Field label={c.phone}><input name="phone" type="tel" /></Field>
            <Field label={c.email}><input name="email" type="email" /></Field>
            <Field label={c.clientType}><select name="clientType" defaultValue="prospect">{['prospect','tenant','buyer','investor','landlord','owner','commercial_tenant','commercial_buyer'].map((value) => <option key={value} value={value}>{crmEnumLabel(value, language)}</option>)}</select></Field>
            <Field label={language === 'zh' ? '国籍' : 'Nationality'}><input name="nationality" /></Field>
            <Field label={c.transactionType}><select name="transactionType" required defaultValue="rent">{['rent','buy','subsale','commercial_rent','commercial_buy','land','new_project'].map((value) => <option key={value} value={value}>{crmEnumLabel(value, language)}</option>)}</select></Field>
            <Field label={c.propertyType}><input name="propertyType" /></Field>
            <Field label={c.preferredAreas}><input name="preferredAreas" placeholder="KLCC, Mont Kiara" /></Field>
            <Field label={c.budgetMin}><input name="budgetMin" type="number" min="0" /></Field>
            <Field label={c.budgetMax}><input name="budgetMax" type="number" min="0" /></Field>
            <Field label={c.bedrooms}><input name="bedroomsMin" type="number" min="0" /></Field>
            <Field label={c.bathrooms}><input name="bathroomsMin" type="number" min="0" /></Field>
            <Field label={c.sizeMin}><input name="sizeMin" type="number" min="0" /></Field>
            <Field label={c.sizeMax}><input name="sizeMax" type="number" min="0" /></Field>
            <Field label={c.furnishing}><input name="furnishing" /></Field>
            <Field label={language === 'zh' ? '停车位需求' : 'Parking requirement'}><input name="parkingRequirement" /></Field>
            <Field label={language === 'zh' ? '宠物需求' : 'Pet requirement'}><input name="petRequirement" /></Field>
            <Field label={c.moveIn}><input name="moveInDate" type="date" /></Field>
            <Field label={c.source}><input name="source" /></Field>
            <Field label={c.priority}><select name="priority" defaultValue="normal">{['hot','warm','normal','low'].map((value) => <option key={value} value={value}>{crmEnumLabel(value, language)}</option>)}</select></Field>
            <Field label={c.nextFollowUp}><input name="nextFollowUpAt" type="datetime-local" /></Field>
            <Field label={c.commercialRequirements} wide><textarea name="commercialRequirements" rows={3} /></Field>
            <Field label={language === 'zh' ? '特殊需求' : 'Special requirements'} wide><textarea name="specialRequirements" rows={3} /></Field>
            <Field label={c.notes} wide><textarea name="notes" rows={3} /></Field>
          </div>
          <footer><button type="button" onClick={() => setCreateOpen(false)}>{c.cancel}</button>{duplicate ? <button type="button" className="crm-primary" disabled={saving} onClick={(event) => { const form = event.currentTarget.closest('form'); if (form) void submitEnquiry({ currentTarget: form, preventDefault() {} } as unknown as React.FormEvent<HTMLFormElement>, true); }}>{c.confirmReuse}</button> : <button type="submit" className="crm-primary" disabled={saving}>{saving ? c.saving : c.save}</button>}</footer>
        </form>
      </div>}

      {dealOpen && <div className="crm-modal" role="dialog" aria-modal="true"><form onSubmit={(event) => void submitDeal(event)}>
        <header><div><p className="eyebrow">CRM</p><h2>{language === 'zh' ? '新建交易' : 'New deal'}</h2></div><button type="button" onClick={() => setDealOpen(false)}><X /></button></header>
        {dealContacts.length === 0 ? <div className="crm-duplicate"><strong>{language === 'zh' ? '请先添加客户。' : 'Add a client before creating a deal.'}</strong><a href="/contacts?action=new-contact">{language === 'zh' ? '添加客户' : 'Add client'} →</a></div> : <div className="crm-form-grid">
          <Field label={c.title} wide><input name="title" required /></Field>
          <Field label={c.client}><select name="contactId" required><option value="">—</option>{dealContacts.map((contact) => <option key={contact.id} value={contact.id}>{displayName(contact)}</option>)}</select></Field>
          <Field label={c.transactionType}><select name="transactionType" defaultValue="rent">{['rent','buy','subsale','commercial_rent','commercial_buy','land','new_project'].map((value) => <option key={value} value={value}>{crmEnumLabel(value, language)}</option>)}</select></Field>
          <Field label={language === 'zh' ? '交易金额' : 'Deal value'}><input name="dealValue" type="number" min="0" /></Field>
          <Field label={language === 'zh' ? '预计佣金' : 'Expected commission'}><input name="expectedCommission" type="number" min="0" /></Field>
          <Field label={c.notes} wide><textarea name="notes" rows={3} /></Field>
        </div>}
        <footer><button type="button" onClick={() => setDealOpen(false)}>{c.cancel}</button>{dealContacts.length > 0 && <button className="crm-primary" disabled={saving}>{saving ? c.saving : c.save}</button>}</footer>
      </form></div>}

      {selectedId && <div className="crm-drawer-backdrop" onClick={() => setSelectedId('')}><aside className="crm-drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">{detail?.record.enquiry_number ?? c.loading}</p><h2>{detail ? displayName(detail.record.contact) : c.loading}</h2></div><button onClick={() => setSelectedId('')} aria-label={c.close}><X /></button></header>
        {!detail ? <div className="crm-state">{c.loading}</div> : <div className="crm-drawer-content">
          <section className="crm-detail-summary"><span className={`crm-badge ${crmStageTone(detail.record.stage)}`}>{crmStageLabel(detail.record.stage, language)}</span><p>{detail.record.property_type || detail.record.transaction_type} · {detail.record.preferred_areas?.join(', ') || '—'}</p><strong>{formatMoney(detail.record.budget_min)} – {formatMoney(detail.record.budget_max)}</strong><p>{detail.record.contact.phone_original || detail.record.contact.email || '—'}</p><a className="crm-client-link" href={`/crm/clients/${detail.record.contact.id}`}>{language === 'zh' ? '打开客户记录' : 'Open client record'} →</a></section>
          {canWrite && (role !== 'agent' || detail.record.assigned_user_id === userId) && <div className="crm-action-grid">
            <button onClick={editEnquiry}>{language === 'zh' ? '编辑询盘' : 'Edit enquiry'}</button>
            {['owner','admin'].includes(role) && <button onClick={() => void reassign()}>{language === 'zh' ? '重新分配' : 'Reassign'}</button>}
            <button onClick={advance} disabled={!availableCrmStageTransitions(detail.record.stage).some((value) => value !== 'LOST') || saving}>{c.advanceStage}<ArrowRight size={14} /></button>
            <button onClick={convertDeal}>{c.convertDeal}</button>
            <a href={`/appointments?action=new&enquiry=${detail.record.id}`}>{c.scheduleAppointment}</a>
            <button onClick={() => { const title = window.prompt(c.title); const dueAt = window.prompt(c.nextFollowUp); if (title && dueAt) void fetch('/api/crm/follow-ups', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ title, dueAt, enquiryId: detail.record.id, contactId: detail.record.contact.id }) }).then(() => loadDetail(detail.record.id)); }}>{c.addFollowUp}</button>
            <button onClick={() => { const listingReference = window.prompt(language === 'zh' ? '房源编号或链接' : 'Listing reference or URL'); if (listingReference) void fetch('/api/crm/matches', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ enquiryId: detail.record.id, listingReference, listingTitle: listingReference }) }).then(() => loadDetail(detail.record.id)); }}>{c.addMatch}</button>
            <button className="danger" onClick={markLost}>{c.markLost}</button>
            <button onClick={() => { if (window.confirm(language === 'zh' ? '确认归档此询盘？' : 'Archive this enquiry?')) void updateEnquiry({ action: 'archive' }); }}>{c.archive}</button>
          </div>}
          <section><h3>{c.related}</h3><div className="crm-related-grid"><Metric label={language === 'zh' ? '房源匹配' : 'Listing matches'} value={detail.matches.length} /><Metric label={language === 'zh' ? '预约' : 'Appointments'} value={detail.appointments.length} /><Metric label={language === 'zh' ? '跟进' : 'Follow-ups'} value={detail.followUps.length} /><Metric label={language === 'zh' ? '交易' : 'Deals'} value={detail.deals.length} /></div></section>
          <section><h3>{c.timeline}</h3><ol className="crm-timeline">{detail.stages.map((item) => <li key={item.id}><span /><div><strong>{crmStageLabel(item.to_stage, language)}</strong><small>{formatDate(item.created_at, language)}</small></div></li>)}{detail.activities.map((item) => <li key={item.id}><span /><div><strong>{item.activity_type.replaceAll('_',' ')}</strong><small>{formatDate(item.created_at, language)}</small></div></li>)}</ol></section>
        </div>}
      </aside></div>}
    </main>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'wide' : ''}><span>{label}</span>{children}</label>;
}
function Metric({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
