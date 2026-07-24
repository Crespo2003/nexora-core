'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Edit3, Mail, Phone, X } from 'lucide-react';
import AppNav from '../../../components/AppNav';
import { usePortalLanguage } from '../../../components/usePortalLanguage';
import { getCrmCopy } from '../../../../lib/i18n/crm';
import { crmStageLabel, isCrmPipelineStage } from '../../../../lib/crm/pipeline';
import type { WorkspaceRole } from '../../../../lib/rbac/permissions';

type Payload = {
  success: boolean; record: Record<string, unknown>; enquiries: Record<string, unknown>[]; appointments: Record<string, unknown>[];
  deals: Record<string, unknown>[]; followUps: Record<string, unknown>[]; activities: Record<string, unknown>[]; role: WorkspaceRole; userId: string;
};

export default function ClientRecord({ clientId, initialRole }: { clientId: string; initialRole: WorkspaceRole }) {
  const language = usePortalLanguage();
  const c = getCrmCopy(language);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/crm/clients/${clientId}`, { cache: 'no-store' });
    const payload = await response.json() as Payload;
    if (response.ok && payload.success) setData(payload); else setError(true);
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);
  const record = data?.record;
  const canWrite = data ? ['owner','admin'].includes(data.role) || (data.role === 'agent' && record?.assigned_user_id === data.userId) : ['owner','admin','agent'].includes(initialRole);
  const name = String(record?.full_name || record?.company_name || '—');

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const response = await fetch(`/api/crm/clients/${clientId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    if (response.ok) { setEditing(false); await load(); } else setError(true);
    setSaving(false);
  }

  return <main className="command-shell crm-shell">
    <header className="command-header crm-header"><div><a className="crm-back" href="/crm"><ArrowLeft size={14} />{c.crmTitle}</a><h1>{name}</h1><p className="header-copy">{String(record?.client_type || c.client)}</p></div><AppNav activePage="crm">{canWrite && <button className="crm-primary" onClick={() => setEditing(true)}><Edit3 size={15} />{language === 'zh' ? '编辑客户' : 'Edit client'}</button>}</AppNav></header>
    {error && <div className="crm-alert">{c.unavailable}</div>}
    {!data ? <div className="crm-state">{c.loading}</div> : <div className="client-record-grid">
      <section className="client-profile-card"><div className="client-avatar">{name.slice(0,2).toUpperCase()}</div><h2>{name}</h2><span className="crm-badge info">{String(record?.client_type || 'prospect')}</span><p><Phone size={14} />{String(record?.phone_original || '—')}</p><p><Mail size={14} />{String(record?.email || '—')}</p><dl><div><dt>{language === 'zh' ? '首选语言' : 'Preferred language'}</dt><dd>{String(record?.preferred_language || 'en')}</dd></div><div><dt>{c.source}</dt><dd>{String(record?.source || '—')}</dd></div><div><dt>{c.notes}</dt><dd>{String(record?.notes || '—')}</dd></div></dl></section>
      <section className="client-journey"><header><h2>{language === 'zh' ? '客户旅程' : 'Client journey'}</h2><div className="crm-related-grid"><Metric label={c.enquiry} value={data.enquiries.length} /><Metric label={language === 'zh' ? '预约' : 'Appointments'} value={data.appointments.length} /><Metric label={language === 'zh' ? '交易' : 'Deals'} value={data.deals.length} /><Metric label={language === 'zh' ? '跟进' : 'Follow-ups'} value={data.followUps.length} /></div></header>
        <div className="client-record-list">{data.enquiries.map((item) => <a href={`/crm?enquiry=${item.id}`} key={String(item.id)}><div><strong>{String(item.enquiry_number)}</strong><span>{String(item.transaction_type)}</span></div><span className="crm-badge info">{isCrmPipelineStage(item.stage) ? crmStageLabel(item.stage, language) : String(item.stage)}</span></a>)}{data.appointments.map((item) => <a href="/appointments" key={String(item.id)}><div><strong>{String(item.title)}</strong><span>{String(item.location || '')}</span></div><span>{new Date(String(item.start_at)).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-MY')}</span></a>)}{data.deals.map((item) => <div key={String(item.id)}><div><strong>{String(item.title)}</strong><span>{String(item.deal_number)}</span></div><span className="crm-badge warning">{isCrmPipelineStage(item.stage) ? crmStageLabel(item.stage, language) : String(item.stage)}</span></div>)}</div>
      </section>
    </div>}
    {editing && record && <div className="crm-modal"><form onSubmit={(event) => void save(event)}><header><h2>{language === 'zh' ? '编辑客户' : 'Edit client'}</h2><button type="button" onClick={() => setEditing(false)}><X /></button></header><div className="crm-form-grid">
      <label><span>{c.fullName}</span><input name="full_name" defaultValue={String(record.full_name || '')} /></label><label><span>{c.companyName}</span><input name="company_name" defaultValue={String(record.company_name || '')} /></label>
      <label><span>{c.phone}</span><input name="phone_original" defaultValue={String(record.phone_original || '')} /></label><label><span>{c.email}</span><input type="email" name="email" defaultValue={String(record.email || '')} /></label>
      <label><span>{c.clientType}</span><select name="client_type" defaultValue={String(record.client_type || 'prospect')}>{['prospect','tenant','buyer','investor','landlord','owner','commercial_tenant','commercial_buyer'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>{language === 'zh' ? '国籍' : 'Nationality'}</span><input name="nationality" defaultValue={String(record.nationality || '')} /></label>
      <label><span>{language === 'zh' ? '首选语言' : 'Preferred language'}</span><select name="preferred_language" defaultValue={String(record.preferred_language || 'en')}><option value="en">English</option><option value="zh">简体中文</option><option value="bilingual">Bilingual</option></select></label>
      <label className="wide"><span>{c.notes}</span><textarea name="notes" rows={4} defaultValue={String(record.notes || '')} /></label>
    </div><footer><button type="button" onClick={() => setEditing(false)}>{c.cancel}</button><button className="crm-primary" disabled={saving}>{saving ? c.saving : c.save}</button></footer></form></div>}
  </main>;
}
function Metric({ label, value }: { label: string; value: number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
