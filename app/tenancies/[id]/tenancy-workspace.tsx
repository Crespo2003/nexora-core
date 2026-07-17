'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Building2, CalendarClock, Check, ChevronDown, Clock3, CreditCard, Download,
  Edit3, FileText, History, Home, LoaderCircle, Plus, ReceiptText, RefreshCw,
  Search, Sparkles, Trash2, Upload, UserRound, UsersRound, WalletCards, X
} from 'lucide-react';
import {
  calculateDaysRemaining, collectionOutstanding, confidencePercent, formatWorkspaceMoney
} from '../../../lib/tenancy-workspace/core';
import { DateInput } from '../../../lib/dates/DateInput';
import { currentIsoDate, currentIsoMonth, formatNexoraDate, formatNexoraDateTime, isoMonthToDisplayMonth } from '../../../lib/dates/formatDate';
import type {
  CollectionPaymentRecord, CollectionRecord, DocumentRecord, TenancySearchResult, TenancyWorkspaceData, UtilityAccountRecord
} from '../../../lib/tenancy-workspace/types';

const filters = ['all', 'expiring', 'overdue', 'vacant', 'occupied', 'outstanding', 'renewal'] as const;
const documentTypes = [
  ['tenancy_agreement', 'Tenancy agreement'], ['inventory_list', 'Inventory'],
  ['utility_bill', 'Utility bill'], ['identity_document', 'Passport / IC'],
  ['letter_of_offer', 'Letter of offer'], ['sale_purchase_agreement', 'SPA'], ['other', 'Images / other']
] as const;
const utilityProviders = ['tnb', 'water', 'iwk', 'wifi', 'aircond', 'other'];

type Notice = { tone: 'success' | 'error'; text: string } | null;

export default function TenancyWorkspace({ tenancyId }: { tenancyId: string }) {
  const [workspace, setWorkspace] = useState<TenancyWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<'property' | 'tenant' | 'landlord' | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<(typeof filters)[number]>('all');
  const [results, setResults] = useState<TenancySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [propertyPhotoUrl, setPropertyPhotoUrl] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/tenancies/${tenancyId}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === 'tenancy-not-found' ? 'Tenancy not found.' : 'Workspace could not be loaded.');
      setWorkspace(body.data);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Workspace could not be loaded.' });
    } finally {
      setLoading(false);
    }
  }, [tenancyId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const photo = workspace?.documents.find((document) => document.mime_type.startsWith('image/'));
    if (!photo) { setPropertyPhotoUrl(''); return; }
    let active = true;
    void fetch('/api/documents/signed-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: photo.id, disposition: 'inline' })
    }).then((response) => response.json()).then((body) => { if (active) setPropertyPhotoUrl(body.signedUrl ?? ''); });
    return () => { active = false; };
  }, [workspace?.documents]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!search.trim() && filter === 'all') { setResults([]); return; }
      setSearching(true);
      try {
        const response = await fetch(`/api/tenancies/search?q=${encodeURIComponent(search)}&filter=${filter}`, { signal: controller.signal });
        const body = await response.json();
        setResults(response.ok ? body.results ?? [] : []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setResults([]);
      } finally { setSearching(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, filter]);

  if (loading) return <WorkspaceLoading />;
  if (!workspace) return <WorkspaceError notice={notice} reload={load} />;

  const tenancy = workspace.tenancy;
  const role = workspace.role;
  const canEdit = ['owner', 'admin', 'manager', 'agent'].includes(role);
  const canFinance = ['owner', 'admin', 'manager', 'finance'].includes(role);
  const canDelete = ['owner', 'admin'].includes(role);
  const daysRemaining = calculateDaysRemaining(tenancy.expiry_date);
  const totalOutstanding = collectionOutstanding(workspace.collections);

  async function saveTenancy(changes: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await fetch(`/api/tenancies/${tenancyId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'tenancy', changes })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Changes could not be saved.');
      setWorkspace((current) => current ? { ...current, tenancy: body.tenancy } : current);
      setEditing(null);
      setNotice({ tone: 'success', text: 'Tenancy details saved.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Changes could not be saved.' });
    } finally { setSaving(false); }
  }

  return (
    <main className="tw-shell">
      <header className="tw-topbar">
        <Link href="/" className="tw-icon-button" aria-label="Back to command centre" title="Back to command centre"><ArrowLeft size={18} /></Link>
        <div className="tw-search-wrap">
          <Search size={17} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tenant, property, phone, account or document" aria-label="Search tenancies" />
          {searching && <LoaderCircle className="tw-spin" size={16} />}
          {(search || filter !== 'all') && (
            <div className="tw-search-results">
              {results.length ? results.map((result) => (
                <Link key={result.id} href={`/tenancies/${result.id}`}>
                  <span><strong>{result.property}</strong><small>{result.tenant} · {result.unitNo || 'No unit'}</small></span>
                  <span className={`tw-status ${result.outstanding > 0 ? 'warning' : ''}`}>{result.outstanding > 0 ? formatWorkspaceMoney(result.outstanding) : result.occupancyStatus}</span>
                </Link>
              )) : <p>No matching tenancies.</p>}
            </div>
          )}
        </div>
        <button className="tw-icon-button" onClick={() => void load()} aria-label="Refresh workspace" title="Refresh workspace"><RefreshCw size={18} /></button>
      </header>

      <nav className="tw-filters" aria-label="Tenancy filters">
        {filters.map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}
      </nav>

      {notice && <div className={`tw-notice ${notice.tone}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button></div>}

      <section className="tw-dashboard" aria-label="Tenancy summary">
        <Metric label="Rental due / 租金" value={formatWorkspaceMoney(workspace.dashboard.rentalDue)} />
        <Metric label="Utilities / 水电费" value={formatWorkspaceMoney(workspace.dashboard.utilitiesDue)} />
        <Metric label="Outstanding / 未付" value={formatWorkspaceMoney(workspace.dashboard.outstanding)} warning={workspace.dashboard.outstanding > 0} />
        <Metric label="Expiring soon / 即将到期" value={String(workspace.dashboard.expiringSoon)} warning={workspace.dashboard.expiringSoon > 0} />
        <Metric label="Renewals / 续约" value={String(workspace.dashboard.renewals)} />
        <Metric label="Documents missing / 缺少文件" value={String(workspace.dashboard.documentsMissing)} warning={workspace.dashboard.documentsMissing > 0} />
      </section>

      {workspace.warnings.length > 0 && <section className="tw-warning-strip" aria-label="AI warnings">{workspace.warnings.map((warning) => <div key={warning.code} className={warning.severity}><AlertTriangle size={16} /><span>{warning.message}</span></div>)}</section>}

      <section className="tw-property-band">
        <div className="tw-property-photo">{propertyPhotoUrl ? <Image src={propertyPhotoUrl} alt={tenancy.property} fill unoptimized sizes="(max-width: 980px) 100vw, 30vw" /> : <><Home size={44} /><span>Property record</span></>}</div>
        <div className="tw-property-main">
          <div className="tw-heading-row">
            <div><p className="tw-eyebrow">AI Tenancy Workspace</p><h1>{tenancy.property}</h1><p>{[tenancy.unit_no, tenancy.property_address].filter(Boolean).join(', ')}</p></div>
            <div className="tw-actions"><span className={`tw-status ${tenancy.occupancy_status === 'vacant' ? 'warning' : 'good'}`}>{tenancy.occupancy_status}</span>{canEdit && <button className="tw-secondary" onClick={() => setEditing('property')}><Edit3 size={16} /> Edit</button>}</div>
          </div>
          <div className="tw-summary-grid">
            <Metric label="Monthly rental" value={formatWorkspaceMoney(tenancy.monthly_rental)} />
            <Metric label="Security deposit" value={formatWorkspaceMoney(tenancy.security_deposit)} />
            <Metric label="Commencement" value={formatDate(tenancy.commencement_date)} />
            <Metric label="Expiry" value={formatDate(tenancy.expiry_date)} />
            <Metric label="Days remaining" value={daysRemaining < 0 ? `${Math.abs(daysRemaining)} overdue` : `${daysRemaining} days`} warning={daysRemaining < 90} />
            <Metric label="Renewal reminder" value={formatDate(tenancy.renewal_reminder)} />
          </div>
        </div>
      </section>

      <div className="tw-two-column">
        <InfoSection icon={<UserRound />} title="Tenant / 租客" onEdit={canEdit ? () => setEditing('tenant') : undefined} rows={[
          ['Name', tenancy.tenant], ['Passport / IC', tenancy.tenant_id_no], ['Phone', tenancy.tenant_phone],
          ['Email', tenancy.tenant_email], ['Nationality', tenancy.tenant_nationality], ['Emergency contact', tenancy.tenant_emergency_contact],
          ['Company', tenancy.tenant_company], ['Occupation', tenancy.tenant_occupation], ['Move-in date', formatDate(tenancy.move_in_date)]
        ]} />
        <InfoSection icon={<UsersRound />} title="Landlord / 房东" onEdit={canEdit ? () => setEditing('landlord') : undefined} rows={[
          ['Name', tenancy.landlord], ['Phone', tenancy.landlord_phone], ['Email', tenancy.landlord_email],
          ['Bank account', tenancy.landlord_bank_account], ['Emergency contact', tenancy.landlord_emergency_contact],
          ['Reminder language', tenancy.landlord_preferred_language]
        ]} />
      </div>

      <CollectionSection tenancyId={tenancyId} collection={workspace.currentCollection} payments={workspace.collectionPayments} totalOutstanding={totalOutstanding} canFinance={canFinance} refresh={load} setNotice={setNotice} />
      <UtilitySection tenancyId={tenancyId} accounts={workspace.utilityAccounts} canEdit={canEdit} refresh={load} setNotice={setNotice} />
      <DocumentSection tenancyId={tenancyId} documents={workspace.documents} canEdit={canEdit} canDelete={canDelete} refresh={load} setNotice={setNotice} />
      <ExtractionSection tenancyId={tenancyId} documents={workspace.documents} canEdit={canEdit} refresh={load} setNotice={setNotice} />

      <section className="tw-section">
        <SectionHeading icon={<History />} title="Timeline / 时间线" subtitle="A permanent trail of tenancy activity" />
        {workspace.timeline.length ? <ol className="tw-timeline">{workspace.timeline.map((event) => (
          <li key={event.id}><span className="tw-timeline-dot" /><div><strong>{event.title}</strong><p>{event.detail || 'Recorded in workspace'}</p></div><time>{formatDateTime(event.createdAt)}</time></li>
        ))}</ol> : <Empty title="No activity yet" text="Actions completed in this tenancy will appear here." />}
      </section>

      {editing && <EditPanel section={editing} tenancy={tenancy} saving={saving} onClose={() => setEditing(null)} onSave={saveTenancy} />}
    </main>
  );
}

function CollectionSection({ tenancyId, collection, payments, totalOutstanding, canFinance, refresh, setNotice }: { tenancyId: string; collection: CollectionRecord | null; payments: CollectionPaymentRecord[]; totalOutstanding: number; canFinance: boolean; refresh: () => Promise<void>; setNotice: (notice: Notice) => void }) {
  const [busy, setBusy] = useState(false); const [recording, setRecording] = useState(false); const [paymentDate, setPaymentDate] = useState(formatNexoraDate(currentIsoDate()));
  async function generate() {
    setBusy(true);
    try {
      const month = `${currentIsoMonth()}-01`;
      const response = await fetch('/api/collections/generate-monthly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collectionMonth: month, tenancyId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message?.en || 'Collection could not be generated.');
      setNotice({ tone: 'success', text: 'Monthly collection generated.' }); await refresh();
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Collection could not be generated.' }); }
    finally { setBusy(false); }
  }
  async function recordPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!collection) return; setBusy(true); const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/collections/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rentalCollectionId: collection.id, amount: Number(form.get('amount')), paymentDate: form.get('paymentDate'), paymentMethod: form.get('paymentMethod'), paymentReference: form.get('paymentReference'), transactionType: form.get('transactionType') }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message?.en || 'Payment could not be recorded.');
      setRecording(false); setNotice({ tone: 'success', text: body.credit > 0 ? `Payment recorded with ${formatWorkspaceMoney(body.credit)} credit.` : 'Payment recorded and balance recalculated.' }); await refresh();
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Payment could not be recorded.' }); } finally { setBusy(false); }
  }
  const charges = collection ? [['Rental', collection.rental_amount], ['TNB', collection.tnb_amount], ['Water', collection.water_amount], ['IWK', collection.iwk_amount], ['WiFi', collection.wifi_amount], ['Aircond', collection.aircond_amount], ['Others', collection.other_charges], ['Late charges', collection.late_charges]] as const : [];
  return <section className="tw-section"><SectionHeading icon={<WalletCards />} title="Monthly Collection / 每月收款" subtitle={collection ? `${formatMonth(collection.collection_month)} · Current charges and collection position` : 'Current charges and collection position'} action={canFinance ? <div className="tw-actions">{collection && <button className="tw-secondary" onClick={() => setRecording(!recording)}><CreditCard size={16} /> Record payment</button>}<button className="tw-primary" disabled={busy} onClick={() => void generate()}>{busy ? <LoaderCircle className="tw-spin" size={16} /> : <Plus size={16} />} Generate collection</button></div> : undefined} />
    {recording && collection && <form className="tw-payment-form" onSubmit={recordPayment}><label>Transaction<select name="transactionType"><option value="payment">Payment</option><option value="advance_payment">Advance payment</option><option value="refund">Refund</option><option value="reversal">Reversal</option></select></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date<DateInput name="paymentDate" value={paymentDate} onValueChange={setPaymentDate} required /></label><label>Method<select name="paymentMethod"><option value="bank_transfer">Bank transfer</option><option value="duitnow">DuitNow</option><option value="cash">Cash</option><option value="online_banking">Online banking</option><option value="other">Other</option></select></label><label>Reference<input name="paymentReference" /></label><button className="tw-primary" disabled={busy}><Check size={16} /> Save</button></form>}
    {collection ? <><div className="tw-charge-grid">{charges.map(([label, value]) => <Metric key={label} label={label} value={formatWorkspaceMoney(value)} />)}</div><div className="tw-balance-bar"><Metric label="All outstanding" value={formatWorkspaceMoney(totalOutstanding)} warning={totalOutstanding > 0} /><Metric label="Amount paid" value={formatWorkspaceMoney(collection.amount_paid)} /><Metric label="Current balance" value={formatWorkspaceMoney(collection.outstanding_balance)} warning={Number(collection.outstanding_balance) > 0} /><Metric label="Credit" value={formatWorkspaceMoney(collection.overpayment_credit)} /><span className={`tw-status ${collection.payment_status === 'paid' ? 'good' : 'warning'}`}>{collection.payment_status}</span></div>{payments.filter((payment) => payment.rental_collection_id === collection.id).length > 0 && <div className="tw-payment-history">{payments.filter((payment) => payment.rental_collection_id === collection.id).slice(0, 6).map((payment) => <div key={payment.id}><span>{humanize(payment.transaction_type)}</span><strong>{formatWorkspaceMoney(payment.amount)}</strong><time>{formatDate(payment.payment_date)}</time></div>)}</div>}</> : <Empty title="No monthly collection" text="Generate the first monthly collection when this tenancy begins." />}
  </section>;
}

function UtilitySection({ tenancyId, accounts, canEdit, refresh, setNotice }: { tenancyId: string; accounts: UtilityAccountRecord[]; canEdit: boolean; refresh: () => Promise<void>; setNotice: (notice: Notice) => void }) {
  const [adding, setAdding] = useState(false); const [editing, setEditing] = useState<UtilityAccountRecord | null>(null); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget);
    try { const response = await fetch('/api/utility-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenancyId, provider: form.get('provider'), accountNumber: form.get('accountNumber'), meterNumber: form.get('meterNumber') }) }); const body = await response.json(); if (!response.ok) throw new Error(body.message?.en || 'Utility account could not be added.'); setAdding(false); setNotice({ tone: 'success', text: 'Utility account added.' }); await refresh(); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Utility account could not be added.' }); } finally { setBusy(false); }
  }
  async function update(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return; setBusy(true); const form = new FormData(event.currentTarget);
    try { const response = await fetch('/api/utility-accounts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id, accountNumber: form.get('accountNumber'), meterNumber: form.get('meterNumber'), accountStatus: form.get('accountStatus') }) }); const body = await response.json(); if (!response.ok) throw new Error(body.message?.en || 'Utility account could not be updated.'); setEditing(null); setNotice({ tone: 'success', text: 'Utility account updated.' }); await refresh(); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Utility account could not be updated.' }); } finally { setBusy(false); }
  }
  return <section className="tw-section"><SectionHeading icon={<Building2 />} title="Utility Accounts / 水电账户" subtitle="Provider details and account change history" action={canEdit ? <button className="tw-secondary" onClick={() => setAdding(!adding)}><Plus size={16} /> Add account</button> : undefined} />
    {adding && <form className="tw-inline-form" onSubmit={submit}><label>Provider<select name="provider">{utilityProviders.map((provider) => <option key={provider}>{provider}</option>)}</select></label><label>Account number<input name="accountNumber" required /></label><label>Meter number<input name="meterNumber" /></label><button className="tw-primary" disabled={busy}>{busy ? <LoaderCircle className="tw-spin" size={16} /> : <Check size={16} />} Save</button></form>}
    {editing && <form className="tw-inline-form" onSubmit={update}><label>Account number<input name="accountNumber" required defaultValue={editing.account_number} /></label><label>Meter number<input name="meterNumber" defaultValue={editing.meter_number} /></label><label>Status<select name="accountStatus" defaultValue={editing.account_status}><option>active</option><option>inactive</option><option>changed</option><option>closed</option></select></label><button className="tw-primary" disabled={busy}>{busy ? <LoaderCircle className="tw-spin" size={16} /> : <Check size={16} />} Update</button></form>}
    {accounts.length ? <div className="tw-table"><div className="tw-table-head"><span>Provider</span><span>Account</span><span>Meter</span><span>Last updated</span><span>History</span><span /></div>{accounts.map((account) => <div className="tw-table-row" key={account.id}><strong>{account.provider.toUpperCase()}</strong><span>{account.account_number_masked || account.account_number}</span><span>{account.meter_number || 'Not set'}</span><span>{formatDate(account.updated_at)}</span><span>{account.history.length} changes</span>{canEdit && <button className="tw-icon-button" onClick={() => setEditing(account)} aria-label={`Edit ${account.provider} account`} title="Edit account"><Edit3 size={16} /></button>}</div>)}</div> : <Empty title="No utility accounts" text="Add provider accounts to connect bills and monthly charges." />}
  </section>;
}

function DocumentSection({ tenancyId, documents, canEdit, canDelete, refresh, setNotice }: { tenancyId: string; documents: DocumentRecord[]; canEdit: boolean; canDelete: boolean; refresh: () => Promise<void>; setNotice: (notice: Notice) => void }) {
  const [uploading, setUploading] = useState(false); const fileRef = useRef<HTMLInputElement>(null); const [type, setType] = useState('tenancy_agreement'); const [provider, setProvider] = useState('tnb');
  async function openDocument(documentId: string, disposition: 'inline' | 'attachment') { const response = await fetch('/api/documents/signed-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId, disposition }) }); const body = await response.json(); if (!response.ok) { setNotice({ tone: 'error', text: 'Document link could not be created.' }); return; } window.open(body.signedUrl, '_blank', 'noopener,noreferrer'); }
  async function upload() { const file = fileRef.current?.files?.[0]; if (!file) return; setUploading(true); const form = new FormData(); form.set('file', file); form.set('documentType', type); form.set('tenancyId', tenancyId); if (type === 'utility_bill') form.set('provider', provider); try { const endpoint = type === 'utility_bill' ? '/api/utility-bills/upload' : '/api/documents/upload'; const response = await fetch(endpoint, { method: 'POST', body: form }); const body = await response.json(); if (!response.ok) { if (body.rollbackStatus === 'document-preserved') await refresh(); throw new Error(body.message?.en || body.error || 'Upload failed.'); } setNotice({ tone: 'success', text: body.message?.en || 'Document uploaded and ready for review.' }); if (fileRef.current) fileRef.current.value = ''; await refresh(); } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Upload failed.' }); } finally { setUploading(false); } }
  async function remove(documentId: string) { if (!window.confirm('Delete this document permanently?')) return; const response = await fetch(`/api/documents/${documentId}`, { method: 'DELETE' }); if (!response.ok) { setNotice({ tone: 'error', text: 'Document could not be deleted.' }); return; } setNotice({ tone: 'success', text: 'Document deleted.' }); await refresh(); }
  async function retry(documentId: string) { setUploading(true); try { const response = await fetch(`/api/documents/${documentId}/retry`, { method: 'POST' }); const body = await response.json(); if (!response.ok) throw new Error(body.message?.en || 'OCR retry failed.'); setNotice({ tone: 'success', text: body.message?.en || 'OCR retry completed.' }); await refresh(); } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'OCR retry failed.' }); } finally { setUploading(false); } }
  return <section className="tw-section"><SectionHeading icon={<FileText />} title="Documents / 文件" subtitle="Secure tenancy files with short-lived preview links" />
    {canEdit && <div className={`tw-upload-bar ${type === 'utility_bill' ? 'utility' : ''}`}><select value={type} onChange={(event) => setType(event.target.value)} aria-label="Document type">{documentTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{type === 'utility_bill' && <select value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="Utility provider">{utilityProviders.map((item) => <option key={item}>{item}</option>)}</select>}<input ref={fileRef} type="file" aria-label="Choose document" /><button className="tw-primary" disabled={uploading} onClick={() => void upload()}>{uploading ? <LoaderCircle className="tw-spin" size={16} /> : <Upload size={16} />} Upload</button></div>}
    {documents.length ? <div className="tw-document-grid">{documents.map((document) => <article key={document.id} className="tw-document"><div className="tw-document-icon"><FileText size={22} /></div><div><strong>{document.original_filename}</strong><p>{labelDocumentType(document.document_type)} · {formatFileSize(document.file_size)} · {processingLabel(document.processing_status)}</p>{document.extraction?.ai_summary && <small><Sparkles size={13} /> {document.extraction.ai_summary}</small>}</div><div className="tw-document-actions"><button onClick={() => void openDocument(document.id, 'inline')} title="Preview" aria-label="Preview"><Search size={17} /></button><button onClick={() => void openDocument(document.id, 'attachment')} title="Download" aria-label="Download"><Download size={17} /></button>{canEdit && ['ocr_required', 'extraction_failed'].includes(document.processing_status) && Number(document.processing_attempts ?? 0) < 3 && <button onClick={() => void retry(document.id)} title="Retry OCR" aria-label="Retry OCR"><RefreshCw size={17} /></button>}{canDelete && <button onClick={() => void remove(document.id)} title="Delete" aria-label="Delete"><Trash2 size={17} /></button>}</div></article>)}</div> : <Empty title="No documents" text="Upload a tenancy agreement, identity document, inventory, utility bill or property image." />}
  </section>;
}

function ExtractionSection({ tenancyId, documents, canEdit, refresh, setNotice }: { tenancyId: string; documents: DocumentRecord[]; canEdit: boolean; refresh: () => Promise<void>; setNotice: (notice: Notice) => void }) {
  const extracted = documents.filter((document) => document.extraction); const [selected, setSelected] = useState(0); const [draft, setDraft] = useState<Record<string, unknown>>({}); const active = extracted[selected];
  useEffect(() => { setDraft(active?.extraction?.extracted_json ?? {}); }, [active?.id]);
  async function save(confirm = false) { if (!active?.extraction) return; const response = await fetch(`/api/tenancies/${tenancyId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'extraction', extractionId: active.extraction.id, extractedJson: draft, confirm }) }); const body = await response.json(); if (!response.ok) { setNotice({ tone: 'error', text: body.message?.en || 'Corrected extraction could not be saved.' }); return; } setNotice({ tone: 'success', text: body.message?.en || (confirm ? 'Extraction confirmed and applied.' : 'Corrections saved for review.') }); await refresh(); }
  return <section className="tw-section"><SectionHeading icon={<Sparkles />} title="AI Extraction / AI 提取" subtitle="Review source text, confidence and corrected values" />
    {active?.extraction ? <div className="tw-extraction"><aside>{extracted.map((document, index) => <button key={document.id} className={selected === index ? 'active' : ''} onClick={() => setSelected(index)}><FileText size={16} /><span>{document.original_filename}<small>{processingLabel(document.processing_status)}</small></span><ChevronDown size={15} /></button>)}</aside><div className="tw-extraction-review"><div className="tw-confidence"><span>Extraction confidence / 提取可信度</span><strong>{averageExtractionConfidence(draft, active.extraction.confidence_json)}%</strong></div><div className="tw-field-grid">{extractionFields(draft, active.extraction.confidence_json).map((field) => <label key={field.path.join('.')} className={field.confidence < 70 ? 'low-confidence' : ''}>{field.label}<input disabled={!canEdit} value={field.value} placeholder="Not detected / 未检测到" onChange={(event) => setDraft((current) => updateExtractionValue(current, field.path, event.target.value))} /><small>{confidenceLabel(field.confidence, Boolean(field.value))}</small></label>)}</div>{canEdit && <div className="tw-review-actions"><button className="tw-secondary" onClick={() => void save(false)}>Save corrections / 保存更正</button><button className="tw-primary" onClick={() => void save(true)}><Check size={16} /> Confirm and apply / 确认并应用</button></div>}<details><summary>Original OCR text / 原始 OCR 文字</summary><pre>{active.extraction.raw_text || 'Not detected / 未检测到'}</pre></details></div></div> : <Empty title="No AI extraction yet" text="Upload a tenancy agreement or utility bill to begin extraction." />}
  </section>;
}

function EditPanel({ section, tenancy, saving, onClose, onSave }: { section: 'property' | 'tenant' | 'landlord'; tenancy: TenancyWorkspaceData['tenancy']; saving: boolean; onClose: () => void; onSave: (changes: Record<string, unknown>) => Promise<void> }) {
  const fields = section === 'property' ? [['property', 'Property name'], ['unit_no', 'Unit'], ['property_address', 'Address'], ['monthly_rental', 'Monthly rental'], ['security_deposit', 'Security deposit'], ['commencement_date', 'Commencement date'], ['expiry_date', 'Expiry date'], ['renewal_reminder', 'Renewal reminder'], ['insurance_expiry', 'Insurance expiry']] : section === 'tenant' ? [['tenant', 'Name'], ['tenant_id_no', 'Passport / IC'], ['tenant_identity_expiry', 'Passport / IC expiry'], ['tenant_phone', 'Phone'], ['tenant_email', 'Email'], ['tenant_nationality', 'Nationality'], ['tenant_emergency_contact', 'Emergency contact'], ['tenant_company', 'Company'], ['tenant_occupation', 'Occupation'], ['move_in_date', 'Move-in date']] : [['landlord', 'Name'], ['landlord_phone', 'Phone'], ['landlord_email', 'Email'], ['landlord_bank_account', 'Bank account'], ['landlord_emergency_contact', 'Emergency contact']];
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const changes = Object.fromEntries(fields.map(([name]) => [name, form.get(name)])); if (section === 'property') changes.occupancy_status = form.get('occupancy_status'); if (section === 'landlord') changes.landlord_preferred_language = form.get('landlord_preferred_language'); await onSave(changes); }
  return <div className="tw-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="tw-drawer" onSubmit={submit}><header><div><p className="tw-eyebrow">Edit tenancy</p><h2>{section}</h2></div><button type="button" className="tw-icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header><div className="tw-drawer-fields">{fields.map(([name, label]) => { const isDate = name.endsWith('_date') || name.endsWith('_expiry') || name === 'renewal_reminder'; const value = String(tenancy[name as keyof typeof tenancy] ?? ''); return <label key={name}>{label}{isDate ? <DateInput name={name} value={value} required={false} /> : <input name={name} type={name.includes('rental') || name.includes('deposit') ? 'number' : 'text'} min={name.includes('rental') || name.includes('deposit') ? '0' : undefined} defaultValue={value} />}</label>; })}{section === 'property' && <label>Occupancy<select name="occupancy_status" defaultValue={tenancy.occupancy_status}><option value="occupied">Occupied</option><option value="vacant">Vacant</option></select></label>}{section === 'landlord' && <label>Reminder language<select name="landlord_preferred_language" defaultValue={tenancy.landlord_preferred_language}><option value="en">English</option><option value="zh">Chinese</option><option value="bilingual">Bilingual</option></select></label>}</div><footer><button type="button" className="tw-secondary" onClick={onClose}>Cancel</button><button className="tw-primary" disabled={saving}>{saving ? <LoaderCircle className="tw-spin" size={16} /> : <Check size={16} />} Save changes</button></footer></form></div>;
}

function SectionHeading({ icon, title, subtitle, action }: { icon: React.ReactNode; title: string; subtitle: string; action?: React.ReactNode }) { return <div className="tw-section-heading"><div className="tw-section-title"><span>{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>{action}</div>; }
function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className={`tw-metric ${warning ? 'warning' : ''}`}><span>{label}</span><strong>{value}</strong></div>; }
function InfoSection({ icon, title, rows, onEdit }: { icon: React.ReactNode; title: string; rows: string[][]; onEdit?: () => void }) { return <section className="tw-section tw-info"><SectionHeading icon={icon} title={title} subtitle="Verified tenancy contact record" action={onEdit ? <button className="tw-icon-button" onClick={onEdit} aria-label={`Edit ${title}`} title={`Edit ${title}`}><Edit3 size={17} /></button> : undefined} /><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>)}</dl></section>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="tw-empty"><ReceiptText size={24} /><div><strong>{title}</strong><p>{text}</p></div></div>; }
function WorkspaceLoading() { return <main className="tw-shell"><div className="tw-loading"><LoaderCircle className="tw-spin" size={30} /><h1>Loading tenancy workspace</h1><p>Bringing together the property, collections, documents and activity.</p></div></main>; }
function WorkspaceError({ notice, reload }: { notice: Notice; reload: () => Promise<void> }) { return <main className="tw-shell"><div className="tw-loading"><Clock3 size={30} /><h1>Workspace unavailable</h1><p>{notice?.text || 'The tenancy could not be loaded.'}</p><button className="tw-primary" onClick={() => void reload()}><RefreshCw size={16} /> Try again</button></div></main>; }
function formatDate(value?: string | null) { return formatNexoraDate(value, 'Not set'); }
function formatMonth(value?: string | null) { return value ? isoMonthToDisplayMonth(value) || 'Not set' : 'Not set'; }
function formatDateTime(value: string) { return formatNexoraDateTime(value); }
function formatFileSize(bytes: number) { if (!bytes) return '0 KB'; return `${(bytes / 1024 / (bytes > 1_048_576 ? 1024 : 1)).toFixed(1)} ${bytes > 1_048_576 ? 'MB' : 'KB'}`; }
function labelDocumentType(value: string) { return documentTypes.find(([type]) => type === value)?.[1] ?? humanize(value); }
function humanize(value: string) { return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()); }
function extractionFields(value: Record<string, unknown>, confidence: Record<string, unknown>, path: string[] = []): Array<{ path: string[]; label: string; value: string; confidence: number }> {
  const fields: Array<{ path: string[]; label: string; value: string; confidence: number }> = [];
  for (const [key, item] of Object.entries(value ?? {})) {
    if (['rawText', 'summary', 'advancedAiConfigured', 'document'].includes(key)) continue;
    const nextPath = [...path, key];
    if (item && typeof item === 'object' && 'value' in item) {
      const extracted = item as { value?: unknown; confidence?: unknown };
      fields.push({ path: nextPath, label: nextPath.map(humanize).join(' / '), value: String(extracted.value ?? ''), confidence: confidencePercent(extracted.confidence) });
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      fields.push(...extractionFields(item as Record<string, unknown>, confidence, nextPath));
    } else if (['string', 'number'].includes(typeof item)) {
      fields.push({ path: nextPath, label: nextPath.map(humanize).join(' / '), value: String(item ?? ''), confidence: confidencePercent(confidence[key] ?? confidence.overall) });
    }
  }
  return fields;
}
function updateExtractionValue(source: Record<string, unknown>, path: string[], value: string) {
  const next = structuredClone(source); let cursor: Record<string, unknown> = next;
  path.slice(0, -1).forEach((key) => { cursor = cursor[key] as Record<string, unknown>; });
  const key = path.at(-1) as string; const current = cursor[key];
  cursor[key] = current && typeof current === 'object' && 'value' in current ? { ...(current as Record<string, unknown>), value, confidence: 'high' } : value;
  return next;
}
function averageExtractionConfidence(value: Record<string, unknown>, confidence: Record<string, unknown>) { const scores = extractionFields(value, confidence).map((field) => field.confidence).filter((score) => score > 0); return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0; }
function processingLabel(value: string) { const labels: Record<string, string> = { uploaded: 'Queued / 排队中', extracting: 'Processing / 处理中', pending_review: 'Review required / 需要检查', extraction_completed: 'Completed / 已完成', imported: 'Completed / 已完成', extraction_failed: 'Failed / 失败', ocr_required: 'Failed / 失败' }; return labels[value] ?? humanize(value); }
function confidenceLabel(score: number, detected: boolean) { if (!detected) return 'Not detected / 未检测到'; if (score >= 85) return `High / 高 · ${score}%`; if (score >= 60) return `Medium / 中 · ${score}%`; return `Low / 低 · ${score}% · Review required / 需要检查`; }
