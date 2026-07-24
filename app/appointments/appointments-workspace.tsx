'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock3, Plus, RefreshCw, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import { usePortalLanguage } from '../components/usePortalLanguage';
import { crmEnumLabel, getCrmCopy } from '../../lib/i18n/crm';
import type { WorkspaceRole } from '../../lib/rbac/permissions';

type Contact = { id: string; full_name?: string; company_name?: string };
type Appointment = {
  id: string; title: string; appointment_type: string; start_at: string; end_at?: string | null;
  status: string; location?: string; meeting_point?: string; address?: string; map_url?: string; notes?: string; outcome?: string; follow_up_at?: string | null; assigned_user_id?: string | null; commercial_listing_id?: string | null;
  contact?: Contact | null; enquiry?: { id: string; enquiry_number: string } | null; deal?: { id: string; deal_number: string; title: string } | null;
};
type Context = { success: boolean; contacts: Contact[]; enquiries: Array<{ id: string; enquiry_number: string; contact_id: string }>; deals: Array<{ id: string; deal_number: string; title: string }>; listings: Array<{ id: string; title: string; property_name?: string }>; role: WorkspaceRole; userId: string };

function contactName(contact?: Contact | null) { return contact?.full_name || contact?.company_name || '—'; }
function dateTime(value: string, language: 'en' | 'zh') {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function localInputDate(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export default function AppointmentsWorkspace({ initialRole }: { initialRole: WorkspaceRole }) {
  const language = usePortalLanguage();
  const c = getCrmCopy(language);
  const [rows, setRows] = useState<Appointment[]>([]);
  const [context, setContext] = useState<Context | null>(null);
  const [role, setRole] = useState(initialRole);
  const [userId, setUserId] = useState('');
  const [tab, setTab] = useState<'upcoming'|'today'|'completed'|'cancelled'>('upcoming');
  const [type, setType] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [contactFilter, setContactFilter] = useState('');
  const [listingFilter, setListingFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [saving, setSaving] = useState(false);
  const canWrite = ['owner','admin','agent'].includes(role);

  const range = useMemo(() => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (tab === 'today') return { from: dayStart.toISOString(), to: dayEnd.toISOString(), status: '' };
    if (tab === 'completed') return { from: '', to: '', status: 'completed' };
    if (tab === 'cancelled') return { from: '', to: '', status: 'cancelled' };
    return { from: now.toISOString(), to: '', status: '' };
  }, [tab]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const params = new URLSearchParams({ pageSize: '100' });
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    if (range.status) params.set('status', range.status);
    if (type) params.set('type', type);
    if (assignedFilter) params.set('assigned', assignedFilter);
    if (contactFilter) params.set('contact', contactFilter);
    if (listingFilter) params.set('listing', listingFilter);
    try {
      const appointmentResponse = await fetch(`/api/crm/appointments?${params}`, { cache: 'no-store' });
      const payload = await appointmentResponse.json() as { success: boolean; rows: Appointment[]; role: WorkspaceRole; userId: string; error?: string };
      if (!appointmentResponse.ok || !payload.success) throw new Error(payload.error || 'request-failed');
      setRows(payload.rows); setRole(payload.role); setUserId(payload.userId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'request-failed'); }
    finally { setLoading(false); }
  }, [assignedFilter, contactFilter, listingFilter, range, type]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void fetch('/api/crm/context', { cache:'no-store' }).then((response)=>response.json()).then((payload:Context)=>{
      if(payload.success)setContext(payload);
    }).catch(()=>null);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action')?.startsWith('new')) setOpen(true);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      title: form.get('title'), appointment_type: form.get('appointment_type'), start_at: form.get('start_at'),
      end_at: form.get('end_at'), contact_id: form.get('contact_id') || null, enquiry_id: form.get('enquiry_id') || null,
      deal_id: form.get('deal_id') || null, commercial_listing_id: form.get('commercial_listing_id') || null,
      location: form.get('location'), meeting_point: form.get('meeting_point'), address: form.get('address'), map_url: form.get('map_url'),
      reminder_minutes: form.get('reminder_minutes'), notes: form.get('notes'), outcome: form.get('outcome'), follow_up_at: form.get('follow_up_at'),
    };
    if (editing) { payload.id = editing.id; payload.status = 'rescheduled'; }
    const response = await fetch('/api/crm/appointments', { method: editing ? 'PATCH' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (response.ok) { setOpen(false); setEditing(null); event.currentTarget.reset(); await load(); } else setError('request-failed');
    setSaving(false);
  }

  async function update(row: Appointment, changes: Record<string, unknown>) {
    const response = await fetch('/api/crm/appointments', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id: row.id, ...changes }) });
    if (response.ok) void load(); else setError('request-failed');
  }

  function canEdit(row: Appointment) {
    return canWrite && (role !== 'agent' || row.assigned_user_id === userId);
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const row of rows) {
      const key = new Date(row.start_at).toISOString().slice(0, 10);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()];
  }, [rows]);

  return (
    <main className="command-shell crm-shell">
      <header className="command-header crm-header">
        <div><p className="eyebrow">NEXORA CORE</p><h1>{c.appointmentsTitle}</h1><p className="header-copy">{c.appointmentsSubtitle}</p></div>
        <AppNav activePage="viewings">{canWrite && <button type="button" className="crm-primary" onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} />{c.newAppointment}</button>}</AppNav>
      </header>
      <section className="crm-toolbar appointments-toolbar">
        <div className="crm-tabs" role="tablist">{(['upcoming','today','completed','cancelled'] as const).map((value) => <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>{c[value]}</button>)}</div>
        <select value={type} onChange={(event) => setType(event.target.value)}><option value="">{c.appointmentType}</option>{['property_viewing','owner_meeting','tenant_meeting','buyer_meeting','commercial_site_visit','negotiation_meeting','signing','handover','inspection','follow_up','internal_meeting'].map((value) => <option key={value} value={value}>{crmEnumLabel(value, language)}</option>)}</select>
        <select value={assignedFilter} onChange={(event)=>setAssignedFilter(event.target.value)}><option value="">{language==='zh'?'全部负责人':'All agents'}</option><option value="me">{language==='zh'?'我的预约':'My appointments'}</option></select>
        <select value={contactFilter} onChange={(event)=>setContactFilter(event.target.value)}><option value="">{language==='zh'?'全部客户':'All clients'}</option>{context?.contacts.map(contact=><option key={contact.id} value={contact.id}>{contactName(contact)}</option>)}</select>
        <select value={listingFilter} onChange={(event)=>setListingFilter(event.target.value)}><option value="">{language==='zh'?'全部房源':'All properties'}</option>{context?.listings.map(listing=><option key={listing.id} value={listing.id}>{listing.title}</option>)}</select>
        <button type="button" className="crm-icon-button" onClick={() => void load()} aria-label={c.refresh}><RefreshCw size={16} /></button>
      </section>
      {!canWrite && <div className="crm-read-only">{c.readOnly}</div>}
      {error && <div className="crm-alert">{c.unavailable}</div>}
      {loading ? <div className="crm-state">{c.loading}</div> : rows.length === 0 ? <div className="crm-state"><CalendarDays size={28} /><strong>{c.emptyAppointments}</strong>{canWrite && <button className="crm-primary" onClick={() => setOpen(true)}>{c.newAppointment}</button>}</div> : (
        <div className="appointment-agenda">
          {grouped.map(([date, items]) => <section key={date}><header><strong>{new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-MY', { weekday:'long', day:'numeric', month:'long' }).format(new Date(`${date}T00:00:00`))}</strong><span>{items.length}</span></header>
            {items.map((row) => <article key={row.id}>
              <time>{new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-MY', { hour:'2-digit', minute:'2-digit' }).format(new Date(row.start_at))}</time>
              <div className="appointment-mark"><span /></div>
              <div className="appointment-main"><div><span className="crm-badge info">{crmEnumLabel(row.appointment_type, language)}</span><span className={`crm-badge ${row.status === 'completed' ? 'success' : row.status === 'cancelled' ? 'danger' : 'warning'}`}>{crmEnumLabel(row.status, language)}</span><strong>{row.title}</strong></div><p>{contactName(row.contact)} · {row.location || '—'}</p><small>{dateTime(row.start_at, language)}{row.end_at ? ` – ${dateTime(row.end_at, language)}` : ''}</small></div>
              {canEdit(row) && <div className="appointment-actions">
                {['proposed','rescheduled'].includes(row.status) && <button onClick={() => void update(row, { status:'confirmed' })}><Check size={14} />{c.confirm}</button>}
                {!['completed','cancelled'].includes(row.status) && <button onClick={() => void update(row, { status:'completed' })}>{c.complete}</button>}
                {!['completed','cancelled'].includes(row.status) && <button onClick={() => void update(row, { status:'no_show' })}>{c.noShow}</button>}
                <button onClick={() => { setEditing(row); setOpen(true); }}><Clock3 size={14} />{c.reschedule}</button>
                <button onClick={() => { const outcome=window.prompt(language==='zh'?'预约结果':'Appointment outcome',row.outcome||''); if(outcome!==null)void update(row,{outcome}); }}>{language==='zh'?'添加结果':'Add outcome'}</button>
                <button onClick={() => { const title=window.prompt(language==='zh'?'跟进标题':'Follow-up title',row.title); const dueAt=window.prompt(language==='zh'?'跟进日期时间':'Follow-up date and time'); if(title&&dueAt)void fetch('/api/crm/follow-ups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,dueAt,appointmentId:row.id,contactId:row.contact?.id})}); }}>{language==='zh'?'创建跟进':'Create follow-up'}</button>
                {row.map_url && <a href={row.map_url} target="_blank" rel="noreferrer">{language==='zh'?'打开地图':'Open map'}</a>}
                {row.enquiry && <a href={`/crm?enquiry=${row.enquiry.id}`}>{language==='zh'?'打开询盘':'Open enquiry'}</a>}
                {row.commercial_listing_id && <a href={`/commercial/listings/${row.commercial_listing_id}`}>{language==='zh'?'打开房源':'Open listing'}</a>}
                {row.contact && <a href={`/crm/clients/${row.contact.id}`}>{language==='zh'?'打开客户':'Open client'}</a>}
                {!['completed','cancelled'].includes(row.status) && <button className="danger" onClick={() => { if (window.confirm(language === 'zh' ? '确认取消此预约？' : 'Cancel this appointment?')) void update(row, { status:'cancelled' }); }}>{c.cancel}</button>}
              </div>}
            </article>)}
          </section>)}
        </div>
      )}
      {open && <div className="crm-modal" role="dialog" aria-modal="true"><form onSubmit={(event) => void submit(event)}>
        <header><div><p className="eyebrow">{editing ? c.reschedule : c.newAppointment}</p><h2>{editing?.title || c.newAppointment}</h2></div><button type="button" onClick={() => { setOpen(false); setEditing(null); }}><X /></button></header>
        <div className="crm-form-grid">
          <label className="wide"><span>{c.title}</span><input name="title" defaultValue={editing?.title} required /></label>
          <label><span>{c.appointmentType}</span><select name="appointment_type" defaultValue={editing?.appointment_type || 'property_viewing'}>{['property_viewing','owner_meeting','tenant_meeting','buyer_meeting','commercial_site_visit','negotiation_meeting','signing','handover','inspection','follow_up','internal_meeting'].map((value) => <option key={value} value={value}>{crmEnumLabel(value, language)}</option>)}</select></label>
          <label><span>{c.contact}</span><select name="contact_id" defaultValue={editing?.contact?.id || ''}><option value="">—</option>{context?.contacts.map((item) => <option value={item.id} key={item.id}>{contactName(item)}</option>)}</select></label>
          <label><span>{c.enquiry}</span><select name="enquiry_id" defaultValue={editing?.enquiry?.id || new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('enquiry') || ''}><option value="">—</option>{context?.enquiries.map((item) => <option value={item.id} key={item.id}>{item.enquiry_number}</option>)}</select></label>
          <label><span>{language === 'zh' ? '交易' : 'Deal'}</span><select name="deal_id" defaultValue={editing?.deal?.id || ''}><option value="">—</option>{context?.deals.map((item) => <option value={item.id} key={item.id}>{item.deal_number} · {item.title}</option>)}</select></label>
          <label><span>{language === 'zh' ? '商业房源' : 'Commercial listing'}</span><select name="commercial_listing_id"><option value="">—</option>{context?.listings.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
          <label><span>{c.startAt}</span><input name="start_at" type="datetime-local" defaultValue={editing ? localInputDate(editing.start_at) : ''} required /></label>
          <label><span>{c.endAt}</span><input name="end_at" type="datetime-local" defaultValue={editing?.end_at ? localInputDate(editing.end_at) : ''} /></label>
          <label className="wide"><span>{c.location}</span><input name="location" defaultValue={editing?.location} /></label>
          <label><span>{language === 'zh' ? '集合点' : 'Meeting point'}</span><input name="meeting_point" defaultValue={editing?.meeting_point} /></label>
          <label><span>{language === 'zh' ? '地址' : 'Address'}</span><input name="address" defaultValue={editing?.address} /></label>
          <label className="wide"><span>{language === 'zh' ? '地图链接' : 'Map link'}</span><input name="map_url" type="url" defaultValue={editing?.map_url} /></label>
          <label><span>{c.reminder}</span><input name="reminder_minutes" type="number" min="0" max="10080" defaultValue="60" /></label>
          <label><span>{c.nextFollowUp}</span><input name="follow_up_at" type="datetime-local" defaultValue={editing?.follow_up_at ? localInputDate(editing.follow_up_at) : ''} /></label>
          <label className="wide"><span>{language === 'zh' ? '结果' : 'Outcome'}</span><textarea name="outcome" rows={2} defaultValue={editing?.outcome} /></label>
          <label className="wide"><span>{c.notes}</span><textarea name="notes" rows={3} defaultValue={editing?.notes} /></label>
        </div>
        <footer><button type="button" onClick={() => setOpen(false)}>{c.cancel}</button><button className="crm-primary" type="submit" disabled={saving}>{saving ? c.saving : c.save}</button></footer>
      </form></div>}
    </main>
  );
}
