'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatDisplayDate, formatDisplayMonth, renderLandlordUpdate, renderTenantReminder } from '../../lib/collections/core';
import type { CollectionOverview, CollectionOverviewRow } from '../../lib/collections/live';
import type { Language } from '../../lib/collections/types';
import { formatMYR } from '../../lib/formatters';
import { defaultLanguage, languageStorageKey } from '../../lib/i18n/translations';
import { DateInput } from '../../lib/dates/DateInput';
import { currentIsoDate, currentIsoMonth, formatNexoraDate, normalizeDateForStorage } from '../../lib/dates/formatDate';
import WhatsAppActions from '../../lib/whatsapp/WhatsAppActions';

type UiLanguage = Exclude<Language, 'bilingual'>;
type ViewKey = 'dashboard' | 'followups' | 'accounts' | 'upload' | 'payment' | 'reminder' | 'landlord' | 'detail';
type NoticeTone = 'info' | 'success' | 'error' | 'warning';

type Notice = {
  tone: NoticeTone;
  message: string;
};

type Filters = {
  month: string;
  property: string;
  tenant: string;
  landlord: string;
  status: string;
  overdue: string;
  provider: string;
  dueFrom: string;
  dueTo: string;
  assignedAgent: string;
  search: string;
};

const currentMonth = currentIsoMonth();

const copy = {
  en: {
    title: 'Smart Collection Centre',
    subtitle: 'Live rental, utility, reminder and follow-up operations from Supabase.',
    utilityMemory: 'Utility Account Memory',
    totalDue: 'Total Due This Month',
    collected: 'Collected This Month',
    outstanding: 'Outstanding This Month',
    overdueAmount: 'Overdue Amount',
    dueToday: 'Due Today',
    dueSoon: 'Due Within 3 Days',
    overdueTenancies: 'Overdue Tenancies',
    billsUpload: 'Bills Awaiting Upload',
    billsReview: 'Bills Awaiting Review',
    missingAccounts: 'Tenancies Without Utility Accounts',
    expiring: 'Expiring 30 / 60 / 90 Days',
    filters: 'Filters',
    followQueue: 'Collection Follow-Up Queue',
    uploadBill: 'Upload Utility Bill',
    billReview: 'Utility Bill Review',
    paymentRecording: 'Payment Recording',
    reminderComposer: 'Reminder Composer',
    landlordUpdate: 'Landlord Update',
    collectionDetail: 'Collection Detail',
    copyMessage: 'Copy Message',
    openWhatsapp: 'Open WhatsApp',
    markSent: 'Mark as Sent',
    generateMonthly: 'Generate Monthly Collections',
    confirmGenerate: 'Confirm generation?',
    noRecords: 'No collection records yet.',
    noResults: 'No matching collection records.',
    loading: 'Loading live collection data...',
    error: 'Unable to load live collection data.',
    retry: 'Retry',
    notDetected: 'Not detected',
    currentAccount: 'Current Account',
    previousAccounts: 'Previous Accounts',
    fullAccount: 'Full account number',
    selectRecord: 'Select a collection record to continue.',
    navRental: 'Rental Command Centre',
    navDocuments: 'Document Centre',
    saved: 'Saved after Supabase confirmation.',
    uploadNeedsRecord: 'Select a collection and tenancy before uploading a bill.'
  },
  zh: {
    title: '智能收款中心',
    subtitle: '从 Supabase 读取实时租金、水电、提醒与跟进资料。',
    utilityMemory: '水电账户记忆库',
    totalDue: '本月应收总额',
    collected: '本月已收',
    outstanding: '本月未结',
    overdueAmount: '逾期金额',
    dueToday: '今日到期',
    dueSoon: '三天内到期',
    overdueTenancies: '逾期租约',
    billsUpload: '待上传账单',
    billsReview: '待检查账单',
    missingAccounts: '缺少水电账户资料',
    expiring: '30 / 60 / 90 天内到期',
    filters: '筛选',
    followQueue: '收款跟进列表',
    uploadBill: '上传水电账单',
    billReview: '水电账单检查',
    paymentRecording: '记录付款',
    reminderComposer: '提醒信息编辑器',
    landlordUpdate: '房东收款更新',
    collectionDetail: '收款详情',
    copyMessage: '复制信息',
    openWhatsapp: '打开 WhatsApp',
    markSent: '标记为已发送',
    generateMonthly: '生成每月收款记录',
    confirmGenerate: '确认生成？',
    noRecords: '暂无收款记录。',
    noResults: '没有符合条件的收款记录。',
    loading: '正在加载实时收款资料...',
    error: '无法加载实时收款资料。',
    retry: '重试',
    notDetected: '未检测到',
    currentAccount: '当前账户',
    previousAccounts: '旧账户记录',
    fullAccount: '完整账户号码',
    selectRecord: '请选择一个收款记录继续。',
    navRental: '租金管理中心',
    navDocuments: '文件中心',
    saved: 'Supabase 确认后已保存。',
    uploadNeedsRecord: '上传账单前请选择收款记录和租约。'
  }
};

export default function CollectionsPage() {
  const [language, setLanguage] = useState<UiLanguage>(defaultLanguage);
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [overview, setOverview] = useState<CollectionOverview | null>(null);
  const [todayIso, setTodayIso] = useState(currentIsoDate());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [operationId, setOperationId] = useState('');
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [reminderLanguage, setReminderLanguage] = useState<Language>('bilingual');
  const [reminderDraft, setReminderDraft] = useState('');
  const [landlordDraft, setLandlordDraft] = useState('');
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentDate: formatNexoraDate(currentIsoDate()),
    paymentMethod: 'bank_transfer',
    transactionType: 'payment',
    paymentReference: '',
    receiptNumber: '',
    notes: ''
  });
  const [billForm, setBillForm] = useState({
    provider: 'tnb',
    file: null as File | null,
    createCollectionIfMissing: false
  });
  const [filters, setFilters] = useState<Filters>({
    month: currentMonth,
    property: '',
    tenant: '',
    landlord: '',
    status: 'all',
    overdue: 'all',
    provider: 'all',
    dueFrom: '',
    dueTo: '',
    assignedAgent: '',
    search: ''
  });
  const t = copy[language];

  useEffect(() => {
    const stored = window.localStorage.getItem(languageStorageKey);
    if (stored === 'en' || stored === 'zh') setLanguage(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(languageStorageKey, language);
  }, [language]);

  useEffect(() => {
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.month, language]);

  const rows = overview?.rows ?? [];
  const selectedRow = rows.find((row) => row.collection.id === selectedCollectionId) ?? rows[0] ?? null;

  useEffect(() => {
    if (rows.length > 0 && !rows.some((row) => row.collection.id === selectedCollectionId)) {
      setSelectedCollectionId(rows[0].collection.id);
    }
  }, [rows, selectedCollectionId]);

  useEffect(() => {
    if (!selectedRow) {
      setReminderDraft('');
      setLandlordDraft('');
      return;
    }
    setReminderDraft(renderTenantReminder({
      tenant: selectedRow.tenancy,
      collection: selectedRow.collection,
      accounts: selectedRow.accounts,
      language: reminderLanguage,
      agentName: selectedRow.tenancy.assignedAgent
    }));
    setLandlordDraft(renderLandlordUpdate({
      tenant: selectedRow.tenancy,
      collection: selectedRow.collection,
      pendingUtilityBills: selectedRow.pendingUtilityBills,
      nextFollowUpDate: selectedRow.nextFollowUpDate || todayIso,
      language: reminderLanguage
    }));
  }, [selectedRow, reminderLanguage, todayIso]);

  async function loadOverview() {
    setLoading(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/collections/overview?month=${encodeURIComponent(filters.month)}&language=${language}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message?.[language] || payload.error || t.error);
      setOverview(payload.overview);
      setTodayIso(payload.todayIso);
    } catch (error) {
      setOverview(null);
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : t.error });
    } finally {
      setLoading(false);
    }
  }

  const upcomingDue7Days = useMemo(() => {
    const target = new Date(`${todayIso}T00:00:00Z`);
    target.setUTCDate(target.getUTCDate() + 7);
    const targetIso = target.toISOString().slice(0, 10);
    return rows.filter((r) => r.collection.dueDate >= todayIso && r.collection.dueDate <= targetIso && r.outstanding > 0).length;
  }, [rows, todayIso]);

  const filteredRows = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      const haystack = [
        row.tenancy.property,
        row.tenancy.unitNo,
        row.tenancy.tenant,
        row.tenancy.landlord,
        row.tenancy.assignedAgent,
        ...row.accounts.map((account) => account.accountNumber)
      ].join(' ').toLowerCase();
      if (filters.property && !row.tenancy.property.toLowerCase().includes(filters.property.toLowerCase())) return false;
      if (filters.tenant && !row.tenancy.tenant.toLowerCase().includes(filters.tenant.toLowerCase())) return false;
      if (filters.landlord && !row.tenancy.landlord.toLowerCase().includes(filters.landlord.toLowerCase())) return false;
      if (filters.status !== 'all' && row.status !== filters.status) return false;
      if (filters.overdue === 'overdue' && row.status !== 'overdue' && row.status !== 'partial') return false;
      if (filters.provider !== 'all' && !row.accounts.some((account) => account.provider === filters.provider)) return false;
      const dueDate = normalizeDateForStorage(row.collection.dueDate);
      const dueFrom = normalizeDateForStorage(filters.dueFrom);
      const dueTo = normalizeDateForStorage(filters.dueTo);
      if (dueFrom && (!dueDate || dueDate < dueFrom)) return false;
      if (dueTo && (!dueDate || dueDate > dueTo)) return false;
      if (filters.assignedAgent && !row.tenancy.assignedAgent.toLowerCase().includes(filters.assignedAgent.toLowerCase())) return false;
      if (query && !haystack.includes(query)) return false;
      return true;
    });
  }, [filters, rows]);

  async function generateMonthlyCollections() {
    if (!confirmGenerate) {
      setConfirmGenerate(true);
      return;
    }
    setOperationId('generate');
    try {
      const response = await fetch('/api/collections/generate-monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionMonth: filters.month })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message?.[language] || payload.technicalReference);
      setNotice({ tone: 'success', message: payload.message?.[language] ?? t.saved });
      setConfirmGenerate(false);
      await loadOverview();
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : t.error });
    } finally {
      setOperationId('');
    }
  }

  async function recordPayment() {
    if (!selectedRow) return;
    setOperationId('payment');
    try {
      const response = await fetch('/api/collections/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalCollectionId: selectedRow.collection.id,
          amount: Number(paymentForm.amount),
          paymentDate: paymentForm.paymentDate,
          paymentMethod: paymentForm.paymentMethod,
          transactionType: paymentForm.transactionType,
          paymentReference: paymentForm.paymentReference,
          receiptNumber: paymentForm.receiptNumber,
          notes: paymentForm.notes
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message?.[language] || payload.technicalReference);
      setNotice({ tone: 'success', message: payload.message?.[language] ?? t.saved });
      setPaymentForm((current) => ({ ...current, amount: '', paymentReference: '', receiptNumber: '', notes: '' }));
      await loadOverview();
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : t.error });
    } finally {
      setOperationId('');
    }
  }

  async function uploadUtilityBill() {
    if (!selectedRow || !billForm.file) {
      setNotice({ tone: 'warning', message: t.uploadNeedsRecord });
      return;
    }
    setOperationId('bill');
    try {
      const data = new FormData();
      data.append('file', billForm.file);
      data.append('provider', billForm.provider);
      data.append('tenancyId', selectedRow.tenancy.id);
      data.append('rentalCollectionId', selectedRow.collection.id);
      data.append('createCollectionIfMissing', String(billForm.createCollectionIfMissing));
      data.append('collectionMonth', filters.month);
      const response = await fetch('/api/utility-bills/upload', { method: 'POST', body: data });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message?.[language] || payload.technicalReference);
      setNotice({ tone: 'success', message: payload.message?.[language] ?? t.saved });
      setBillForm({ provider: 'tnb', file: null, createCollectionIfMissing: false });
      await loadOverview();
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : t.error });
    } finally {
      setOperationId('');
    }
  }

  async function logReminder(sentStatus: 'draft' | 'copied' | 'sent') {
    if (!selectedRow) return;
    const messageText = activeView === 'landlord' ? landlordDraft : reminderDraft;
    setOperationId(`reminder-${sentStatus}`);
    try {
      if (sentStatus === 'copied') await navigator.clipboard?.writeText(messageText);
      const response = await fetch('/api/collection-reminders/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalCollectionId: selectedRow.collection.id,
          reminderType: activeView === 'landlord' ? 'landlord_collection_update' : 'tenant_collection_reminder',
          language: reminderLanguage,
          messageText,
          sentStatus
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message?.[language] || payload.technicalReference);
      setNotice({ tone: 'success', message: payload.message?.[language] ?? t.saved });
      await loadOverview();
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : t.error });
    } finally {
      setOperationId('');
    }
  }

  async function persistFollowup(action: string) {
    if (!selectedRow) return;
    setOperationId(`followup-${action}`);
    try {
      const response = await fetch('/api/collection-followups/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalCollectionId: selectedRow.collection.id, action })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message?.[language] || payload.technicalReference);
      setNotice({ tone: 'success', message: payload.message?.[language] ?? t.saved });
      await loadOverview();
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : t.error });
    } finally {
      setOperationId('');
    }
  }

  return (
    <main className="command-shell collections-shell">
      <header className="command-header">
        <div>
          <p className="eyebrow">NEXORA / Sprint 003</p>
          <h1>{t.title}</h1>
          <p className="header-copy">{t.subtitle}</p>
        </div>
        <div className="header-actions">
          <div className="language-toggle">
            <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button>
            <button className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>中文</button>
          </div>
          <nav className="top-nav" aria-label="Primary">
            <a className="ghost-button" href="/">{t.navRental}</a>
            <a className="ghost-button" href="/documents">{t.navDocuments}</a>
            <a className="ghost-button active" href="/collections">{t.title}</a>
            <a className="ghost-button" href="/commercial">{language === 'zh' ? '商业 CRM' : 'Commercial CRM'}</a>
          </nav>
        </div>
      </header>

      {notice && <div className={`notice ${notice.tone}`}>{notice.message}</div>}
      {loading && <LoadingState text={t.loading} />}
      {!loading && notice?.tone === 'error' && <button className="secondary-button" onClick={loadOverview}>{t.retry}</button>}

      {!loading && overview && (
        <>
          <Metrics metrics={overview.metrics} language={language} />
          <nav className="module-tabs" aria-label="Collection modules">
            {(['dashboard', 'followups', 'accounts', 'upload', 'payment', 'reminder', 'landlord', 'detail'] as ViewKey[]).map((view) => (
              <button className={activeView === view ? 'active' : ''} key={view} onClick={() => setActiveView(view)}>
                {viewLabel(view, language)}
              </button>
            ))}
          </nav>
          <section className="panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">{t.filters}</p>
                <h2>{formatDisplayMonth(filters.month)}</h2>
              </div>
              <button className="secondary-button" onClick={generateMonthlyCollections} disabled={operationId === 'generate'}>
                {confirmGenerate ? t.confirmGenerate : t.generateMonthly}
              </button>
            </div>
            <FiltersPanel filters={filters} language={language} onChange={setFilters} />
          </section>

          {rows.length === 0 ? (
            <section className="panel bottom-grid">
              <EmptyState title={t.noRecords} body={language === 'zh' ? '请先建立租约，然后生成每月收款记录。' : 'Create a tenancy, then generate monthly collection records.'} />
            </section>
          ) : (
            <>
              {activeView === 'dashboard' && (
                <section className="panel bottom-grid">
                  <div className="section-title">
                    <div>
                      <p className="eyebrow">{t.title}</p>
                      <h2>{formatDisplayMonth(filters.month)} &mdash; {filteredRows.length} {language === 'zh' ? '条记录' : 'records'}</h2>
                    </div>
                  </div>
                  <CollectionTable
                    rows={filteredRows}
                    language={language}
                    selectedId={selectedRow?.collection.id ?? ''}
                    onSelect={setSelectedCollectionId}
                    onAction={(id, action) => { setSelectedCollectionId(id); setActiveView(action); }}
                    emptyText={t.noResults}
                  />
                </section>
              )}

              {activeView === 'followups' && <FollowupQueue rows={rows} language={language} onSelect={(row, action) => { setSelectedCollectionId(row.collection.id); if (action) void persistFollowup(action); }} />}
              {activeView === 'accounts' && <AccountsPanel rows={rows} language={language} />}
              {activeView === 'upload' && <UploadPanel language={language} selectedRow={selectedRow} billForm={billForm} setBillForm={setBillForm} onUpload={uploadUtilityBill} busy={operationId === 'bill'} />}
              {activeView === 'payment' && <PaymentPanel language={language} selectedRow={selectedRow} form={paymentForm} setForm={setPaymentForm} onSave={recordPayment} busy={operationId === 'payment'} />}
              {activeView === 'reminder' && selectedRow && <ComposerPanel title={t.reminderComposer} message={reminderDraft} setMessage={setReminderDraft} language={language} reminderLanguage={reminderLanguage} onLanguage={setReminderLanguage} phone={selectedRow.tenancy.tenantPhone} onLog={logReminder} busy={operationId.startsWith('reminder')} />}
              {activeView === 'landlord' && selectedRow && <ComposerPanel title={t.landlordUpdate} message={landlordDraft} setMessage={setLandlordDraft} language={language} reminderLanguage={reminderLanguage} onLanguage={setReminderLanguage} phone={selectedRow.tenancy.landlordPhone} onLog={logReminder} busy={operationId.startsWith('reminder')} />}
              {activeView === 'detail' && selectedRow && (
                <section className="workspace-grid bottom-grid">
                  <DetailPanel row={selectedRow} language={language} />
                  <ActivityPanel row={selectedRow} language={language} />
                </section>
              )}
            </>
          )}
        </>
      )}
    </main>
  );

  function Metrics({ metrics, language }: { metrics: CollectionOverview['metrics']; language: UiLanguage }) {
    return (
      <section className="metrics-grid collection-metrics">
        <Metric label={t.totalDue} value={formatMYR(metrics.totalDueThisMonth)} />
        <Metric label={t.collected} value={formatMYR(metrics.collectedThisMonth)} tone="success" />
        <Metric label={t.outstanding} value={formatMYR(metrics.outstandingThisMonth)} tone={metrics.outstandingThisMonth ? 'danger' : 'success'} />
        <Metric label={t.overdueAmount} value={formatMYR(metrics.overdueAmount)} tone={metrics.overdueAmount ? 'danger' : undefined} />
        <Metric label={language === 'zh' ? '7天内到期' : 'Due in 7 Days'} value={String(upcomingDue7Days)} tone={upcomingDue7Days ? 'danger' : undefined} />
        <Metric label={t.dueToday} value={String(metrics.dueToday)} />
        <Metric label={t.dueSoon} value={String(metrics.dueWithin3Days)} />
        <Metric label={t.overdueTenancies} value={String(metrics.overdueTenancies)} tone={metrics.overdueTenancies ? 'danger' : undefined} />
        <Metric label={t.billsUpload} value={String(metrics.utilityBillsAwaitingUpload)} />
        <Metric label={t.billsReview} value={String(metrics.utilityBillsAwaitingReview)} />
        <Metric label={t.missingAccounts} value={String(metrics.tenanciesMissingUtilityAccounts)} />
        <Metric label={t.expiring} value={`${metrics.expiring30} / ${metrics.expiring60} / ${metrics.expiring90}`} />
      </section>
    );
  }
}

function viewLabel(view: ViewKey, language: UiLanguage) {
  const labels: Record<ViewKey, { en: string; zh: string }> = {
    dashboard: { en: 'Dashboard', zh: '仪表板' },
    followups: { en: 'Follow-Up Queue', zh: '跟进列表' },
    accounts: { en: 'Utility Accounts', zh: '水电账户' },
    upload: { en: 'Bill Upload', zh: '账单上传' },
    payment: { en: 'Payment', zh: '付款记录' },
    reminder: { en: 'Reminder', zh: '提醒信息' },
    landlord: { en: 'Landlord Update', zh: '房东更新' },
    detail: { en: 'Collection Detail', zh: '收款详情' }
  };
  return labels[view][language];
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return <div className={`metric ${tone ?? ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

function FiltersPanel({ filters, language, onChange }: { filters: Filters; language: UiLanguage; onChange: (filters: Filters) => void }) {
  return (
    <div className="filters-grid collection-filters">
      <Field label={language === 'zh' ? '月份' : 'Collection month'} value={filters.month} onChange={(value) => onChange({ ...filters, month: value })} />
      <Field label={language === 'zh' ? '房产' : 'Property'} value={filters.property} onChange={(value) => onChange({ ...filters, property: value })} />
      <Field label={language === 'zh' ? '租客' : 'Tenant'} value={filters.tenant} onChange={(value) => onChange({ ...filters, tenant: value })} />
      <Field label={language === 'zh' ? '房东' : 'Landlord'} value={filters.landlord} onChange={(value) => onChange({ ...filters, landlord: value })} />
      <SelectField label={language === 'zh' ? '付款状态' : 'Payment status'} value={filters.status} options={['all', 'pending', 'due', 'paid', 'partial', 'outstanding', 'overdue', 'waived', 'disputed']} onChange={(value) => onChange({ ...filters, status: value })} />
      <SelectField label={language === 'zh' ? '逾期状态' : 'Overdue status'} value={filters.overdue} options={['all', 'overdue']} onChange={(value) => onChange({ ...filters, overdue: value })} />
      <SelectField label={language === 'zh' ? '水电供应商' : 'Utility provider'} value={filters.provider} options={['all', 'tnb', 'water', 'iwk', 'wifi', 'aircond', 'other']} onChange={(value) => onChange({ ...filters, provider: value })} />
        <DateField label={language === 'zh' ? '到期日起' : 'Due from'} value={filters.dueFrom} onChange={(value) => onChange({ ...filters, dueFrom: value })} />
        <DateField label={language === 'zh' ? '到期日至' : 'Due to'} value={filters.dueTo} onChange={(value) => onChange({ ...filters, dueTo: value })} />
      <Field label={language === 'zh' ? '负责中介' : 'Assigned agent'} value={filters.assignedAgent} onChange={(value) => onChange({ ...filters, assignedAgent: value })} />
      <Field label={language === 'zh' ? '搜索' : 'Search'} value={filters.search} onChange={(value) => onChange({ ...filters, search: value })} wide />
    </div>
  );
}

function CollectionList({ rows, language, selectedId, onSelect, emptyText }: { rows: CollectionOverviewRow[]; language: UiLanguage; selectedId: string; onSelect: (id: string) => void; emptyText: string }) {
  if (rows.length === 0) return <EmptyState title={emptyText} body={language === 'zh' ? '调整筛选条件后重试。' : 'Adjust filters and try again.'} />;
  return (
    <div className="collection-list">
      {rows.map((row) => (
        <button className={`collection-list-row ${selectedId === row.collection.id ? 'is-active' : ''}`} key={row.collection.id} onClick={() => onSelect(row.collection.id)}>
          <span><strong>{row.tenancy.property} {row.tenancy.unitNo}</strong><small>{row.tenancy.tenant} / {row.tenancy.landlord}</small></span>
          <span>{formatDisplayMonth(row.collection.collectionMonth)}</span>
          <span>{formatMYR(row.outstanding)}</span>
          <span className={`status-pill ${row.status}`}>{row.urgency}</span>
        </button>
      ))}
    </div>
  );
}

function FollowupQueue({ rows, language, onSelect }: { rows: CollectionOverviewRow[]; language: UiLanguage; onSelect: (row: CollectionOverviewRow, action?: string) => void }) {
  const dueRows = rows.filter((row) => row.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
  if (dueRows.length === 0) return <section className="panel bottom-grid"><EmptyState title={language === 'zh' ? '暂无跟进事项' : 'No follow-ups today'} body={language === 'zh' ? '所有收款记录已处理。' : 'All live collection records are settled.'} /></section>;
  return (
    <section className="panel bottom-grid">
      <div className="section-title"><div><p className="eyebrow">{language === 'zh' ? '收款跟进列表' : 'Collection Follow-Up Queue'}</p><h2>{dueRows.length}</h2></div></div>
      <div className="followup-grid">
        {dueRows.map((row) => (
          <article className="followup-card" key={row.collection.id}>
            <h3>{row.tenancy.tenant} / {row.tenancy.property} {row.tenancy.unitNo}</h3>
            <p>{row.tenancy.landlord} / {formatDisplayMonth(row.collection.collectionMonth)}</p>
            <strong>{formatMYR(row.outstanding)}</strong>
            <span className="status-pill overdue">{row.urgency}</span>
            <div className="card-actions">
              <button onClick={() => onSelect(row)}>{language === 'zh' ? '生成提醒' : 'Generate reminder'}</button>
              <button onClick={() => onSelect(row, 'contacted')}>{language === 'zh' ? '标记已联系' : 'Mark contacted'}</button>
              <button onClick={() => onSelect(row, 'snoozed')}>{language === 'zh' ? '延后' : 'Snooze'}</button>
              <button onClick={() => onSelect(row, 'promise_to_pay')}>{language === 'zh' ? '承诺付款' : 'Promise to pay'}</button>
              <button onClick={() => onSelect(row, 'escalated')}>{language === 'zh' ? '升级处理' : 'Escalate'}</button>
              <WhatsAppActions
                contact={{ name: row.tenancy.tenant, role: 'tenant', represents: 'tenant', phone: row.tenancy.tenantPhone }}
                tenancyId={row.tenancy.id}
                defaultTemplateType={row.outstanding > 0 ? 'rental_overdue' : 'general_follow_up'}
                variables={{
                  tenant_name: row.tenancy.tenant, property_name: row.tenancy.property, unit_number: row.tenancy.unitNo,
                  monthly_rental: row.tenancy.monthlyRental, amount_due: row.outstanding, outstanding_amount: row.outstanding,
                  due_date: row.collection.dueDate, agent_name: row.tenancy.assignedAgent
                }}
                uiLanguage={language}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AccountsPanel({ rows, language }: { rows: CollectionOverviewRow[]; language: UiLanguage }) {
  const accounts = rows.flatMap((row) => row.accounts);
  return (
    <section className="workspace-grid bottom-grid">
      <div className="panel">
        <div className="section-title"><div><p className="eyebrow">{language === 'zh' ? '水电账户记忆库' : 'Utility Account Memory'}</p><h2>{language === 'zh' ? '当前账户' : 'Current Account'}</h2></div></div>
        {accounts.length === 0 ? <EmptyState title={language === 'zh' ? '暂无水电账户' : 'No utility accounts yet'} body={language === 'zh' ? '确认账单后会建立账户记忆。' : 'Confirmed bills will create utility account memory.'} /> : (
          <div className="utility-account-grid">
            {accounts.map((account) => (
              <article className="memory-item" key={account.id}>
                <span>{account.provider} / {account.property}</span>
                <p>{account.accountNumberMasked}</p>
                <details><summary>{language === 'zh' ? '完整账户号码' : 'Full account number'}</summary><p>{account.accountNumber}</p></details>
                <p>{account.registeredName || (language === 'zh' ? '未检测到' : 'Not detected')}</p>
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="panel">
        <div className="section-title"><div><p className="eyebrow">{language === 'zh' ? '旧账户记录' : 'Previous Accounts'}</p><h2>{language === 'zh' ? '由历史表保留' : 'Stored in history table'}</h2></div></div>
        <EmptyState title={language === 'zh' ? '账户更换后会显示在这里' : 'Account changes appear here'} body={language === 'zh' ? '旧账户不会被覆盖。' : 'Previous account numbers are never overwritten.'} />
      </div>
    </section>
  );
}

function UploadPanel({ language, selectedRow, billForm, setBillForm, onUpload, busy }: { language: UiLanguage; selectedRow: CollectionOverviewRow | null; billForm: { provider: string; file: File | null; createCollectionIfMissing: boolean }; setBillForm: (form: { provider: string; file: File | null; createCollectionIfMissing: boolean }) => void; onUpload: () => void; busy: boolean }) {
  return (
    <section className="workspace-grid bottom-grid">
      <div className="panel">
        <div className="section-title"><div><p className="eyebrow">{language === 'zh' ? '上传水电账单' : 'Upload Utility Bill'}</p><h2>{selectedRow ? `${selectedRow.tenancy.property} ${selectedRow.tenancy.unitNo}` : '-'}</h2></div></div>
        <label className="field"><span>{language === 'zh' ? '供应商' : 'Provider'}</span><select value={billForm.provider} onChange={(event) => setBillForm({ ...billForm, provider: event.target.value })}><option value="tnb">TNB</option><option value="water">Water</option><option value="iwk">IWK</option><option value="wifi">WiFi</option><option value="aircond">Air-conditioning</option><option value="other">Other</option></select></label>
        <label className="field"><span>{language === 'zh' ? '账单文件' : 'Bill file'}</span><input type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png" onChange={(event) => setBillForm({ ...billForm, file: event.target.files?.[0] ?? null })} /></label>
        <label className="field"><span>{language === 'zh' ? '如缺少收款记录则创建' : 'Create collection if missing'}</span><input type="checkbox" checked={billForm.createCollectionIfMissing} onChange={(event) => setBillForm({ ...billForm, createCollectionIfMissing: event.target.checked })} /></label>
        <button className="primary-button" onClick={onUpload} disabled={busy || !billForm.file}>{busy ? (language === 'zh' ? '上传中...' : 'Uploading...') : (language === 'zh' ? '上传并等待检查' : 'Upload for review')}</button>
      </div>
      <div className="panel">
        <div className="section-title"><div><p className="eyebrow">{language === 'zh' ? '水电账单检查' : 'Utility Bill Review'}</p><h2>{language === 'zh' ? '确认后才更新收款' : 'Collection updates after confirmation only'}</h2></div></div>
        <EmptyState title={language === 'zh' ? '上传后显示提取结果' : 'Extraction appears after upload'} body={language === 'zh' ? '低信心资料会在检查页标记。' : 'Low-confidence values are highlighted during review.'} />
      </div>
    </section>
  );
}

function PaymentPanel({ language, selectedRow, form, setForm, onSave, busy }: { language: UiLanguage; selectedRow: CollectionOverviewRow | null; form: Record<string, string>; setForm: (form: any) => void; onSave: () => void; busy: boolean }) {
  if (!selectedRow) return <section className="panel bottom-grid"><EmptyState title={language === 'zh' ? '请选择收款记录' : 'Select a collection'} body="" /></section>;
  return (
    <section className="panel bottom-grid">
      <div className="section-title"><div><p className="eyebrow">{language === 'zh' ? '记录付款' : 'Payment Recording'}</p><h2>{selectedRow.tenancy.tenant}</h2></div></div>
      <div className="form-grid">
        <Field label={language === 'zh' ? '金额' : 'Amount'} value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />
        <DateField label={language === 'zh' ? '付款日期' : 'Payment date'} value={form.paymentDate} onChange={(value) => setForm({ ...form, paymentDate: value })} />
        <SelectField label={language === 'zh' ? '付款方式' : 'Payment method'} value={form.paymentMethod} options={['bank_transfer', 'cash', 'duitnow', 'touch_n_go', 'cheque', 'online_banking', 'other']} onChange={(value) => setForm({ ...form, paymentMethod: value })} />
        <SelectField label={language === 'zh' ? '交易类型' : 'Transaction type'} value={form.transactionType} options={['payment', 'adjustment', 'waiver', 'refund', 'reversal']} onChange={(value) => setForm({ ...form, transactionType: value })} />
        <Field label={language === 'zh' ? '银行参考' : 'Bank reference'} value={form.paymentReference} onChange={(value) => setForm({ ...form, paymentReference: value })} />
        <Field label={language === 'zh' ? '收据号码' : 'Receipt number'} value={form.receiptNumber} onChange={(value) => setForm({ ...form, receiptNumber: value })} />
        <label className="field wide"><span>{language === 'zh' ? '备注' : 'Notes'}</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
      </div>
      <button className="primary-button" onClick={onSave} disabled={busy}>{busy ? (language === 'zh' ? '保存中...' : 'Saving...') : (language === 'zh' ? '记录付款' : 'Record payment')}</button>
    </section>
  );
}

function ComposerPanel({ title, message, setMessage, language, reminderLanguage, onLanguage, phone, onLog, busy }: { title: string; message: string; setMessage: (message: string) => void; language: UiLanguage; reminderLanguage: Language; onLanguage: (language: Language) => void; phone: string; onLog: (status: 'draft' | 'copied' | 'sent') => void; busy: boolean }) {
  return (
    <section className="panel bottom-grid">
      <div className="section-title"><div><p className="eyebrow">{title}</p><h2>WhatsApp-ready</h2></div></div>
      <div className="form-grid">
        <label className="field"><span>{language === 'zh' ? '语言' : 'Language'}</span><select value={reminderLanguage} onChange={(event) => onLanguage(event.target.value as Language)}><option value="en">English</option><option value="zh">中文</option><option value="bilingual">English + 中文</option></select></label>
        <label className="field wide"><span>{language === 'zh' ? '信息' : 'Message'}</span><textarea rows={16} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
      </div>
      <div className="card-actions review-actions">
        <button onClick={() => onLog('draft')} disabled={busy}>{language === 'zh' ? '保存草稿' : 'Save Draft'}</button>
        <button onClick={() => onLog('copied')} disabled={busy}>{language === 'zh' ? '复制信息' : 'Copy Message'}</button>
        <a className="secondary-button" href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">{language === 'zh' ? '打开 WhatsApp' : 'Open WhatsApp'}</a>
        <button onClick={() => onLog('sent')} disabled={busy}>{language === 'zh' ? '标记为已发送' : 'Mark as Sent'}</button>
      </div>
    </section>
  );
}

function DetailPanel({ row, language }: { row: CollectionOverviewRow; language: UiLanguage }) {
  return (
    <div className="panel">
      <div className="section-title"><div><p className="eyebrow">{language === 'zh' ? '收款详情' : 'Collection detail'}</p><h2>{row.tenancy.property} {row.tenancy.unitNo}</h2></div></div>
      <div className="memory-stack">
        <Memory label={language === 'zh' ? '租客' : 'Tenant'} value={row.tenancy.tenant} />
        <Memory label={language === 'zh' ? '房东' : 'Landlord'} value={row.tenancy.landlord} />
        <Memory label={language === 'zh' ? '到期日' : 'Due date'} value={formatDisplayDate(row.collection.dueDate)} />
        <Memory label={language === 'zh' ? '租金' : 'Rental'} value={formatMYR(row.collection.rentalAmount)} />
        <Memory label="TNB / Water / IWK" value={`${formatMYR(row.collection.tnbAmount)} / ${formatMYR(row.collection.waterAmount)} / ${formatMYR(row.collection.iwkAmount)}`} />
        <Memory label="WiFi / Air-cond / Other" value={`${formatMYR(row.collection.wifiAmount)} / ${formatMYR(row.collection.aircondAmount)} / ${formatMYR(row.collection.otherCharges)}`} />
        <Memory label={language === 'zh' ? '应收总额' : 'Total due'} value={formatMYR(row.total)} />
        <Memory label={language === 'zh' ? '已付' : 'Paid'} value={formatMYR(row.paid)} />
        <Memory label={language === 'zh' ? '未结' : 'Outstanding'} value={formatMYR(row.outstanding)} />
        <Memory label={language === 'zh' ? '最后提醒' : 'Last reminder'} value={row.lastReminderDate ? formatDisplayDate(row.lastReminderDate.slice(0, 10)) : (language === 'zh' ? '未检测到' : 'Not detected')} />
      </div>
    </div>
  );
}

function ActivityPanel({ row, language }: { row: CollectionOverviewRow; language: UiLanguage }) {
  return (
    <div className="panel">
      <div className="section-title"><div><p className="eyebrow">{language === 'zh' ? '活动记录' : 'Activity'}</p><h2>{row.status}</h2></div></div>
      <div className="memory-stack">
        <Memory label={language === 'zh' ? '付款流水' : 'Payment ledger'} value={`${row.collection.paymentLedger.length}`} />
        <Memory label={language === 'zh' ? '提醒次数' : 'Reminder count'} value={`${row.reminderCount}`} />
        <Memory label={language === 'zh' ? '水电账单' : 'Utility bills'} value={`${row.collection.utilityBillIds.length}`} />
        <Memory label={language === 'zh' ? '跟进状态' : 'Follow-up status'} value={row.followupStatus || (language === 'zh' ? '未检测到' : 'Not detected')} />
      </div>
    </div>
  );
}

function Field({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return <label className={wide ? 'wide field' : 'field'}><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function DateField({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return <label className={wide ? 'wide field' : 'field'}><span>{label}</span><DateInput value={value} onValueChange={onChange} /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>;
}

function Memory({ label, value }: { label: string; value: string }) {
  return <div className="memory-item"><span>{label}</span><p>{value || '-'}</p></div>;
}

type CollectionTableAction = 'payment' | 'reminder' | 'detail';

function CollectionTable({ rows, language, selectedId, onSelect, onAction, emptyText }: {
  rows: CollectionOverviewRow[];
  language: UiLanguage;
  selectedId: string;
  onSelect: (id: string) => void;
  onAction: (id: string, action: CollectionTableAction) => void;
  emptyText: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyText} body={language === 'zh' ? '调整筛选条件后重试。' : 'Adjust filters and try again.'} />;
  const zh = language === 'zh';
  return (
    <div className="collection-table-wrap">
      <table className="collection-data-table">
        <thead>
          <tr>
            <th>{zh ? '租客' : 'Tenant'}</th>
            <th>{zh ? '房产' : 'Property'}</th>
            <th>{zh ? '单位' : 'Unit'}</th>
            <th>{zh ? '月租' : 'Monthly Rental'}</th>
            <th>TNB</th>
            <th>{zh ? '水费' : 'Water'}</th>
            <th>IWK</th>
            <th>WiFi</th>
            <th>{zh ? '空调' : 'Air Con'}</th>
            <th>{zh ? '其他' : 'Other'}</th>
            <th>{zh ? '应收' : 'Total Due'}</th>
            <th>{zh ? '已付' : 'Amount Paid'}</th>
            <th>{zh ? '未结' : 'Outstanding'}</th>
            <th>{zh ? '到期日' : 'Due Date'}</th>
            <th>{zh ? '付款日' : 'Paid Date'}</th>
            <th>{zh ? '付款方式' : 'Method'}</th>
            <th>{zh ? '收据号' : 'Receipt No'}</th>
            <th>{zh ? '备注' : 'Remarks'}</th>
            <th>{zh ? '状态' : 'Status'}</th>
            <th>{zh ? '操作' : 'Actions'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { collection, tenancy } = row;
            const lastPayment = [...collection.paymentLedger].sort((a, b) => (a.paymentDate > b.paymentDate ? -1 : 1)).at(0);
            const waPhone = tenancy.tenantPhone.replace(/[^0-9+]/g, '');
            const isActive = selectedId === collection.id;
            return (
              <tr key={collection.id} className={isActive ? 'is-active' : ''} onClick={() => onSelect(collection.id)}>
                <td>{tenancy.tenant || '-'}</td>
                <td>{tenancy.property || '-'}</td>
                <td>{tenancy.unitNo || '-'}</td>
                <td className="cdt-num">{formatMYR(tenancy.monthlyRental)}</td>
                <td className="cdt-num">{collection.tnbAmount ? formatMYR(collection.tnbAmount) : '-'}</td>
                <td className="cdt-num">{collection.waterAmount ? formatMYR(collection.waterAmount) : '-'}</td>
                <td className="cdt-num">{collection.iwkAmount ? formatMYR(collection.iwkAmount) : '-'}</td>
                <td className="cdt-num">{collection.wifiAmount ? formatMYR(collection.wifiAmount) : '-'}</td>
                <td className="cdt-num">{collection.aircondAmount ? formatMYR(collection.aircondAmount) : '-'}</td>
                <td className="cdt-num">{collection.otherCharges ? formatMYR(collection.otherCharges) : '-'}</td>
                <td className="cdt-num cdt-bold">{formatMYR(row.total)}</td>
                <td className="cdt-num cdt-success">{formatMYR(row.paid)}</td>
                <td className={`cdt-num ${row.outstanding > 0 ? 'cdt-danger' : 'cdt-success'}`}>{formatMYR(row.outstanding)}</td>
                <td>{formatDisplayDate(collection.dueDate)}</td>
                <td>{lastPayment?.paymentDate ? formatDisplayDate(lastPayment.paymentDate) : '-'}</td>
                <td>{lastPayment?.paymentMethod ? lastPayment.paymentMethod.replace('_', ' ') : '-'}</td>
                <td>{lastPayment?.receiptNumber || '-'}</td>
                <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{collection.notes || '-'}</td>
                <td><span className={`status-pill ${row.status}`}>{row.status}</span></td>
                <td className="cdt-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="action-chip" onClick={() => onAction(collection.id, 'detail')}>{zh ? '查看' : 'View'}</button>
                  <button className="action-chip action-chip--pay" onClick={() => onAction(collection.id, 'payment')}>{zh ? '付款' : 'Pay'}</button>
                  {waPhone && (
                    <a className="action-chip action-chip--wa" href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer">WA</a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><h3>{title}</h3><p>{body}</p></div>;
}

function LoadingState({ text }: { text: string }) {
  return <section className="panel skeleton-panel"><div className="loader-ring" /><h2>{text}</h2><div className="skeleton-grid"><div /><div /><div /><div /></div></section>;
}
