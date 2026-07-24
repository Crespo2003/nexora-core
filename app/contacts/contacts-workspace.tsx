'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Mail, Phone, Plus, Search, UserRound, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import { usePortalLanguage } from '../components/usePortalLanguage';
import { getCrmCopy } from '../../lib/i18n/crm';
import type { WorkspaceRole } from '../../lib/rbac/permissions';

type Client = { id:string; full_name?:string; company_name?:string; phone_original?:string; email?:string; client_type?:string; preferred_language?:string; source?:string; updated_at?:string };
export default function ContactsWorkspace({initialRole}:{initialRole:WorkspaceRole}) {
  const language=usePortalLanguage(); const c=getCrmCopy(language);
  const [rows,setRows]=useState<Client[]>([]); const [query,setQuery]=useState(''); const [role,setRole]=useState(initialRole);
  const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [open,setOpen]=useState(false); const [saving,setSaving]=useState(false);
  const canWrite=['owner','admin','agent'].includes(role);
  const load=useCallback(async()=>{setLoading(true);const params=new URLSearchParams({pageSize:'100'});if(query.trim())params.set('q',query.trim());try{const response=await fetch(`/api/crm/clients?${params}`,{cache:'no-store'});const payload=await response.json() as {success:boolean;rows:Client[];role:WorkspaceRole};if(!response.ok||!payload.success)throw new Error();setRows(payload.rows);setRole(payload.role);}catch{setError('request-failed');}finally{setLoading(false);}},[query]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),250);return()=>window.clearTimeout(timer);},[load]);
  useEffect(()=>{if(new URLSearchParams(window.location.search).get('action')==='new-contact')setOpen(true);},[]);
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setSaving(true);const form=new FormData(event.currentTarget);const response=await fetch('/api/crm/clients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(form.entries()))});const payload=await response.json() as {duplicateWarning?:boolean};if(response.status===409&&payload.duplicateWarning)setError(language==='zh'?'发现相同电话或电邮的客户，请打开现有记录。':'A client with the same phone or email already exists. Open the existing record.');else if(response.ok){setOpen(false);event.currentTarget.reset();await load();}else setError('request-failed');setSaving(false);}
  return <main className="command-shell crm-shell"><header className="command-header crm-header"><div><p className="eyebrow">NEXORA CORE</p><h1>{language==='zh'?'客户名录':'Client Directory'}</h1><p className="header-copy">{language==='zh'?'为所有询盘、预约和交易维护一个可信客户记录。':'Maintain one trusted client record across every enquiry, appointment, and deal.'}</p></div><AppNav activePage="contacts">{canWrite&&<button className="crm-primary" onClick={()=>setOpen(true)}><Plus size={16}/>{language==='zh'?'添加客户':'Add client'}</button>}</AppNav></header>
  <section className="crm-toolbar"><label className="crm-search"><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={c.search}/></label></section>
  {error&&<div className="crm-alert">{error==='request-failed'?c.unavailable:error}</div>}{!canWrite&&<div className="crm-read-only">{c.readOnly}</div>}
  {loading?<div className="crm-state">{c.loading}</div>:rows.length===0?<div className="crm-state"><UserRound size={28}/><strong>{language==='zh'?'暂无客户记录。':'No client records yet.'}</strong>{canWrite&&<button className="crm-primary" onClick={()=>setOpen(true)}>{language==='zh'?'添加首位客户':'Add first client'}</button>}</div>:<div className="client-card-grid">{rows.map(row=><a href={`/crm/clients/${row.id}`} key={row.id}><div className="client-card-icon">{row.company_name&&!row.full_name?<Building2/>:<UserRound/>}</div><div><h2>{row.full_name||row.company_name||'—'}</h2><span className="crm-badge info">{row.client_type||'prospect'}</span><p><Phone size={13}/>{row.phone_original||'—'}</p><p><Mail size={13}/>{row.email||'—'}</p><small>{row.source||'—'}</small></div></a>)}</div>}
  {open&&<div className="crm-modal"><form onSubmit={event=>void submit(event)}><header><h2>{language==='zh'?'添加客户':'Add client'}</h2><button type="button" onClick={()=>setOpen(false)}><X/></button></header><div className="crm-form-grid">
    <label><span>{c.fullName}</span><input name="full_name"/></label><label><span>{c.companyName}</span><input name="company_name"/></label><label><span>{c.phone}</span><input name="phone_original" type="tel"/></label><label><span>{c.email}</span><input name="email" type="email"/></label>
    <label><span>{c.clientType}</span><select name="client_type" defaultValue="prospect">{['prospect','tenant','buyer','investor','landlord','owner','commercial_tenant','commercial_buyer'].map(value=><option key={value}>{value}</option>)}</select></label><label><span>{language==='zh'?'国籍':'Nationality'}</span><input name="nationality"/></label><label><span>{language==='zh'?'首选语言':'Preferred language'}</span><select name="preferred_language"><option value="en">English</option><option value="zh">简体中文</option><option value="bilingual">Bilingual</option></select></label>
    <label><span>{c.source}</span><input name="source"/></label><label className="wide"><span>{c.notes}</span><textarea name="notes" rows={3}/></label>
  </div><footer><button type="button" onClick={()=>setOpen(false)}>{c.cancel}</button><button className="crm-primary" disabled={saving}>{saving?c.saving:c.save}</button></footer></form></div>}</main>;
}
