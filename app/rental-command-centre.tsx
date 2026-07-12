'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type PaymentStatus = 'paid' | 'partial' | 'outstanding' | 'late';
type NoticeTone = 'info' | 'success' | 'error';

type Notice = {
  tone: NoticeTone;
  message: string;
};

type PaymentHistory = {
  id: string;
  paidOn: string;
  amount: number;
  method: string;
  reference: string;
};

type Tenancy = {
  id: string;
  tenant: string;
  landlord: string;
  property: string;
  monthlyRental: number;
  deposit: number;
  utilityDeposit: number;
  accessCardDeposit: number;
  commencementDate: string;
  expiryDate: string;
  renewalReminder: string;
  signedTa: string;
  renewalHistory: string;
  specialClauses: string;
  notes: string;
};

type RentalCollection = {
  id: string;
  tenancyId: string;
  collectionMonth: string;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  status: PaymentStatus;
  paymentHistory: PaymentHistory[];
};

type TenancyForm = Omit<Tenancy, 'id'>;

const currency = new Intl.NumberFormat('en-MY', {
  currency: 'MYR',
  style: 'currency',
  maximumFractionDigits: 0
});

const todayIso = new Date().toISOString().slice(0, 10);
const currentMonth = todayIso.slice(0, 7);

const emptyForm: TenancyForm = {
  tenant: '',
  landlord: '',
  property: '',
  monthlyRental: 0,
  deposit: 0,
  utilityDeposit: 0,
  accessCardDeposit: 0,
  commencementDate: todayIso,
  expiryDate: todayIso,
  renewalReminder: todayIso,
  signedTa: '',
  renewalHistory: '',
  specialClauses: '',
  notes: ''
};

const seedTenancies: Tenancy[] = [
  {
    id: 'demo-tenancy-1',
    tenant: 'Peng Ying',
    landlord: 'Ryan Holdings',
    property: 'Verticas Residensi B-16-02',
    monthlyRental: 10000,
    deposit: 20000,
    utilityDeposit: 3000,
    accessCardDeposit: 600,
    commencementDate: '2026-06-01',
    expiryDate: '2027-05-31',
    renewalReminder: '2027-03-31',
    signedTa: 'Signed TA uploaded - Verticas_B1602_TA.pdf',
    renewalHistory: 'Initial term: 1 Jun 2026 to 31 May 2027',
    specialClauses: 'Tenant handles minor repairs below RM300. No short-term sublet.',
    notes: 'Prefers WhatsApp reminders three days before due date.'
  },
  {
    id: 'demo-tenancy-2',
    tenant: 'Alicia Tan',
    landlord: 'Nexora Landlord Pool',
    property: 'Aria Residence A-21-08',
    monthlyRental: 5200,
    deposit: 10400,
    utilityDeposit: 1500,
    accessCardDeposit: 400,
    commencementDate: '2026-07-01',
    expiryDate: '2027-06-30',
    renewalReminder: '2027-04-30',
    signedTa: 'Awaiting countersigned copy',
    renewalHistory: 'New tenancy',
    specialClauses: 'Two access cards included. Professional cleaning on handover.',
    notes: 'First collection expected by bank transfer.'
  }
];

const seedCollections: RentalCollection[] = [
  {
    id: 'demo-collection-1',
    tenancyId: 'demo-tenancy-1',
    collectionMonth: '2026-07',
    dueDate: '2026-07-01',
    amountDue: 10000,
    amountPaid: 6500,
    status: 'partial',
    paymentHistory: [
      {
        id: 'demo-payment-1',
        paidOn: '2026-07-04',
        amount: 6500,
        method: 'Bank transfer',
        reference: 'MBB-7781'
      }
    ]
  },
  {
    id: 'demo-collection-2',
    tenancyId: 'demo-tenancy-2',
    collectionMonth: '2026-07',
    dueDate: '2026-07-01',
    amountDue: 5200,
    amountPaid: 5200,
    status: 'paid',
    paymentHistory: [
      {
        id: 'demo-payment-2',
        paidOn: '2026-07-01',
        amount: 5200,
        method: 'DuitNow',
        reference: 'DN-9140'
      }
    ]
  }
];

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  return createClient(url, anonKey);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) return String(error.message);
  return 'Something went wrong. Please try again.';
}

function toCollectionStatus(amountDue: number, amountPaid: number, dueDate: string): PaymentStatus {
  if (amountPaid >= amountDue) return 'paid';
  if (new Date(dueDate) < new Date(todayIso)) return amountPaid > 0 ? 'partial' : 'late';
  return amountPaid > 0 ? 'partial' : 'outstanding';
}

function sanitizeForm(form: TenancyForm): TenancyForm {
  return {
    ...form,
    tenant: form.tenant.trim(),
    landlord: form.landlord.trim(),
    property: form.property.trim(),
    signedTa: form.signedTa.trim(),
    renewalHistory: form.renewalHistory.trim(),
    specialClauses: form.specialClauses.trim(),
    notes: form.notes.trim()
  };
}

function validateTenancyForm(form: TenancyForm): string | null {
  const requiredFields = [form.tenant, form.landlord, form.property];
  const moneyFields = [form.monthlyRental, form.deposit, form.utilityDeposit, form.accessCardDeposit];

  if (requiredFields.some((value) => value.trim().length === 0)) {
    return 'Tenant, landlord and property are required.';
  }

  if (moneyFields.some((value) => !Number.isFinite(value) || value < 0)) {
    return 'Rental and deposit values cannot be negative.';
  }

  if (new Date(form.expiryDate) < new Date(form.commencementDate)) {
    return 'Expiry date cannot be before commencement date.';
  }

  return null;
}

function mapTenancyFromDatabase(row: Record<string, unknown>): Tenancy {
  return {
    id: String(row.id),
    tenant: String(row.tenant ?? ''),
    landlord: String(row.landlord ?? ''),
    property: String(row.property ?? ''),
    monthlyRental: Number(row.monthly_rental ?? 0),
    deposit: Number(row.deposit ?? 0),
    utilityDeposit: Number(row.utility_deposit ?? 0),
    accessCardDeposit: Number(row.access_card_deposit ?? 0),
    commencementDate: String(row.commencement_date ?? todayIso),
    expiryDate: String(row.expiry_date ?? todayIso),
    renewalReminder: String(row.renewal_reminder ?? todayIso),
    signedTa: String(row.signed_ta ?? ''),
    renewalHistory: String(row.renewal_history ?? ''),
    specialClauses: String(row.special_clauses ?? ''),
    notes: String(row.notes ?? '')
  };
}

function toTenancyPayload(form: TenancyForm) {
  return {
    tenant: form.tenant,
    landlord: form.landlord,
    property: form.property,
    monthly_rental: form.monthlyRental,
    deposit: form.deposit,
    utility_deposit: form.utilityDeposit,
    access_card_deposit: form.accessCardDeposit,
    commencement_date: form.commencementDate,
    expiry_date: form.expiryDate,
    renewal_reminder: form.renewalReminder || null,
    signed_ta: form.signedTa,
    renewal_history: form.renewalHistory,
    special_clauses: form.specialClauses,
    notes: form.notes
  };
}

function mapCollectionFromDatabase(row: Record<string, unknown>): RentalCollection {
  const amountDue = Number(row.amount_due ?? 0);
  const amountPaid = Number(row.amount_paid ?? 0);
  const dueDate = String(row.due_date ?? todayIso);

  return {
    id: String(row.id),
    tenancyId: String(row.tenancy_id ?? ''),
    collectionMonth: String(row.collection_month ?? '').slice(0, 7),
    dueDate,
    amountDue,
    amountPaid,
    status: String(row.status ?? toCollectionStatus(amountDue, amountPaid, dueDate)) as PaymentStatus,
    paymentHistory: Array.isArray(row.payment_history) ? (row.payment_history as PaymentHistory[]) : []
  };
}

function nextCollectionForTenancy(tenancy: Tenancy): RentalCollection {
  return {
    id: `collection-${crypto.randomUUID()}`,
    tenancyId: tenancy.id,
    collectionMonth: currentMonth,
    dueDate: `${currentMonth}-01`,
    amountDue: tenancy.monthlyRental,
    amountPaid: 0,
    status: toCollectionStatus(tenancy.monthlyRental, 0, `${currentMonth}-01`),
    paymentHistory: []
  };
}

function toCollectionPayload(collection: RentalCollection) {
  return {
    tenancy_id: collection.tenancyId,
    collection_month: `${collection.collectionMonth}-01`,
    due_date: collection.dueDate,
    amount_due: collection.amountDue,
    amount_paid: collection.amountPaid,
    status: collection.status,
    payment_history: collection.paymentHistory
  };
}

export default function RentalCommandCentre() {
  const supabase = useMemo(getSupabaseClient, []);
  const isDemoMode = !supabase;
  const [tenancies, setTenancies] = useState<Tenancy[]>(isDemoMode ? seedTenancies : []);
  const [collections, setCollections] = useState<RentalCollection[]>(isDemoMode ? seedCollections : []);
  const [selectedTenancyId, setSelectedTenancyId] = useState(isDemoMode ? seedTenancies[0]?.id ?? '' : '');
  const [editingTenancyId, setEditingTenancyId] = useState<string | null>(null);
  const [form, setForm] = useState<TenancyForm>(emptyForm);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [notice, setNotice] = useState<Notice>(
    isDemoMode
      ? { tone: 'info', message: 'Demo data shown because Supabase env vars are missing.' }
      : { tone: 'info', message: 'Connecting to Supabase rental tables...' }
  );
  const [isLoading, setIsLoading] = useState(!isDemoMode);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const selectedTenancy = tenancies.find((tenancy) => tenancy.id === selectedTenancyId) ?? tenancies[0] ?? null;
  const selectedCollections = collections.filter((collection) => collection.tenancyId === selectedTenancy?.id);

  const totalMonthlyRental = tenancies.reduce((sum, tenancy) => sum + tenancy.monthlyRental, 0);
  const totalDue = collections.reduce((sum, collection) => sum + collection.amountDue, 0);
  const totalPaid = collections.reduce((sum, collection) => sum + collection.amountPaid, 0);
  const outstandingBalance = Math.max(totalDue - totalPaid, 0);
  const lateCount = collections.filter((collection) => collection.status === 'late' || collection.status === 'partial').length;
  const depositExposure = tenancies.reduce(
    (sum, tenancy) => sum + tenancy.deposit + tenancy.utilityDeposit + tenancy.accessCardDeposit,
    0
  );

  useEffect(() => {
    loadRentalData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRentalData() {
    if (!supabase) return;

    setIsLoading(true);

    try {
      const [{ data: tenancyRows, error: tenancyError }, { data: collectionRows, error: collectionError }] = await Promise.all([
        supabase.from('tenancies').select('*').order('created_at', { ascending: false }),
        supabase.from('rental_collections').select('*').order('collection_month', { ascending: false })
      ]);

      if (tenancyError) throw tenancyError;
      if (collectionError) throw collectionError;

      const loadedTenancies = (tenancyRows ?? []).map(mapTenancyFromDatabase);
      const loadedCollections = (collectionRows ?? []).map(mapCollectionFromDatabase);

      setTenancies(loadedTenancies);
      setCollections(loadedCollections);
      setSelectedTenancyId(loadedTenancies[0]?.id ?? '');
      setNotice({
        tone: 'success',
        message: loadedTenancies.length
          ? 'Supabase connected. Rental tables verified and live data loaded.'
          : 'Supabase connected. Rental tables verified; create the first tenancy to begin.'
      });
    } catch (error) {
      setTenancies([]);
      setCollections([]);
      setNotice({
        tone: 'error',
        message: `Supabase rental tables could not be verified: ${getErrorMessage(error)}`
      });
    } finally {
      setIsLoading(false);
    }
  }

  function resetForm() {
    setEditingTenancyId(null);
    setForm(emptyForm);
  }

  async function saveTenancy() {
    const cleanForm = sanitizeForm(form);
    const validationError = validateTenancyForm(cleanForm);

    if (validationError) {
      setNotice({ tone: 'error', message: validationError });
      return;
    }

    setOperationId('save-tenancy');

    try {
      if (editingTenancyId) {
        let savedTenancy: Tenancy = { ...cleanForm, id: editingTenancyId };

        if (supabase && !editingTenancyId.startsWith('demo-')) {
          const { data, error } = await supabase
            .from('tenancies')
            .update(toTenancyPayload(cleanForm))
            .eq('id', editingTenancyId)
            .select('*')
            .single();

          if (error) throw error;
          savedTenancy = mapTenancyFromDatabase(data);
        }

        setTenancies((current) => current.map((tenancy) => (tenancy.id === editingTenancyId ? savedTenancy : tenancy)));
        setNotice({ tone: 'success', message: 'Tenancy updated and confirmed.' });
      } else {
        const localTenancy: Tenancy = { ...cleanForm, id: `tenancy-${crypto.randomUUID()}` };
        let savedTenancy = localTenancy;

        if (supabase) {
          const { data, error } = await supabase.from('tenancies').insert(toTenancyPayload(cleanForm)).select('*').single();
          if (error) throw error;
          savedTenancy = mapTenancyFromDatabase(data);
        }

        const savedCollection = await createCollectionRecord(savedTenancy, false);

        setTenancies((current) => [savedTenancy, ...current]);
        setCollections((current) => (savedCollection ? [savedCollection, ...current] : current));
        setSelectedTenancyId(savedTenancy.id);
        setNotice({ tone: 'success', message: 'Tenancy created and current-month collection confirmed.' });
      }

      resetForm();
    } catch (error) {
      setNotice({ tone: 'error', message: `Tenancy was not saved: ${getErrorMessage(error)}` });
    } finally {
      setOperationId(null);
    }
  }

  async function createCollectionRecord(tenancy: Tenancy, updateUi = true): Promise<RentalCollection | null> {
    const duplicate = collections.some(
      (collection) => collection.tenancyId === tenancy.id && collection.collectionMonth === currentMonth
    );

    if (duplicate) {
      setNotice({ tone: 'error', message: 'This tenancy already has a collection record for the current month.' });
      return null;
    }

    let savedCollection = nextCollectionForTenancy(tenancy);

    if (supabase && !tenancy.id.startsWith('demo-')) {
      const { data, error } = await supabase
        .from('rental_collections')
        .insert(toCollectionPayload(savedCollection))
        .select('*')
        .single();

      if (error) throw error;
      savedCollection = mapCollectionFromDatabase(data);
    }

    if (updateUi) {
      setCollections((current) => [savedCollection, ...current]);
      setNotice({ tone: 'success', message: 'Current-month collection record created.' });
    }

    return savedCollection;
  }

  async function confirmDeleteTenancy(id: string) {
    setOperationId(`delete-${id}`);

    try {
      if (supabase && !id.startsWith('demo-')) {
        const { error } = await supabase.from('tenancies').delete().eq('id', id);
        if (error) throw error;
      }

      const remainingTenancies = tenancies.filter((tenancy) => tenancy.id !== id);
      setTenancies(remainingTenancies);
      setCollections((current) => current.filter((collection) => collection.tenancyId !== id));
      setSelectedTenancyId(remainingTenancies[0]?.id ?? '');
      setPendingDeleteId(null);
      setNotice({ tone: 'success', message: 'Tenancy deleted and linked collection records removed.' });
    } catch (error) {
      setNotice({ tone: 'error', message: `Tenancy was not deleted: ${getErrorMessage(error)}` });
    } finally {
      setOperationId(null);
    }
  }

  function startEdit(tenancy: Tenancy) {
    const { id: _id, ...editable } = tenancy;
    setEditingTenancyId(tenancy.id);
    setForm(editable);
    setSelectedTenancyId(tenancy.id);
    setPendingDeleteId(null);
  }

  async function addPayment(collection: RentalCollection) {
    const amount = Number(paymentAmount);
    const outstanding = Math.max(collection.amountDue - collection.amountPaid, 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice({ tone: 'error', message: 'Enter a valid positive payment amount.' });
      return;
    }

    if (amount > outstanding) {
      setNotice({ tone: 'error', message: 'Payment cannot exceed the outstanding balance.' });
      return;
    }

    setOperationId(`payment-${collection.id}`);

    try {
      const payment: PaymentHistory = {
        id: `payment-${crypto.randomUUID()}`,
        paidOn: todayIso,
        amount,
        method: 'Manual record',
        reference: paymentReference.trim() || 'No reference'
      };

      const nextAmountPaid = collection.amountPaid + amount;
      const status = toCollectionStatus(collection.amountDue, nextAmountPaid, collection.dueDate);
      const updatedCollection = {
        ...collection,
        amountPaid: nextAmountPaid,
        status,
        paymentHistory: [payment, ...collection.paymentHistory]
      };

      if (supabase && !collection.id.startsWith('demo-')) {
        const { data, error } = await supabase
          .from('rental_collections')
          .update({
            amount_paid: updatedCollection.amountPaid,
            status: updatedCollection.status,
            payment_history: updatedCollection.paymentHistory
          })
          .eq('id', collection.id)
          .select('*')
          .single();

        if (error) throw error;
        const savedCollection = mapCollectionFromDatabase(data);
        setCollections((current) => current.map((item) => (item.id === collection.id ? savedCollection : item)));
      } else {
        setCollections((current) => current.map((item) => (item.id === collection.id ? updatedCollection : item)));
      }

      setPaymentAmount('');
      setPaymentReference('');
      setNotice({ tone: 'success', message: 'Payment persisted and balances recalculated.' });
    } catch (error) {
      setNotice({ tone: 'error', message: `Payment was not recorded: ${getErrorMessage(error)}` });
    } finally {
      setOperationId(null);
    }
  }

  return (
    <main className="command-shell">
      <header className="command-header">
        <div>
          <p className="eyebrow">NEXORA AI / Sprint 002</p>
          <h1>Rental Command Centre</h1>
          <p className="header-copy">Production Supabase workflows, safer rental data, and confirmed collection records.</p>
        </div>
        <div className="live-badge">{isDemoMode ? 'Demo fallback' : 'Supabase live'}</div>
      </header>

      <section className="metrics-grid" aria-label="Rental command metrics">
        <Metric label="Monthly rental" value={currency.format(totalMonthlyRental)} />
        <Metric label="Outstanding" value={currency.format(outstandingBalance)} tone={outstandingBalance > 0 ? 'danger' : 'success'} />
        <Metric label="Collected" value={currency.format(totalPaid)} />
        <Metric label="Late / partial" value={String(lateCount)} tone={lateCount > 0 ? 'danger' : 'success'} />
      </section>

      <div className={`notice ${notice.tone}`} role="status">{notice.message}</div>

      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          <section className="workspace-grid">
            <div className="panel">
              <div className="section-title">
                <div>
                  <p className="eyebrow">Tenancy desk</p>
                  <h2>{editingTenancyId ? 'Edit tenancy' : 'Create tenancy'}</h2>
                </div>
                {editingTenancyId && (
                  <button className="ghost-button" onClick={resetForm} disabled={operationId === 'save-tenancy'}>
                    Cancel
                  </button>
                )}
              </div>

              <div className="form-grid">
                <Field label="Tenant" value={form.tenant} onChange={(value) => setForm({ ...form, tenant: value })} required />
                <Field label="Landlord" value={form.landlord} onChange={(value) => setForm({ ...form, landlord: value })} required />
                <Field label="Property" value={form.property} onChange={(value) => setForm({ ...form, property: value })} wide required />
                <NumberField label="Monthly rental" value={form.monthlyRental} onChange={(value) => setForm({ ...form, monthlyRental: value })} />
                <NumberField label="Deposit" value={form.deposit} onChange={(value) => setForm({ ...form, deposit: value })} />
                <NumberField label="Utility deposit" value={form.utilityDeposit} onChange={(value) => setForm({ ...form, utilityDeposit: value })} />
                <NumberField label="Access card deposit" value={form.accessCardDeposit} onChange={(value) => setForm({ ...form, accessCardDeposit: value })} />
                <Field type="date" label="Commencement date" value={form.commencementDate} onChange={(value) => setForm({ ...form, commencementDate: value })} />
                <Field type="date" label="Expiry date" value={form.expiryDate} onChange={(value) => setForm({ ...form, expiryDate: value })} />
                <Field type="date" label="Renewal reminder" value={form.renewalReminder} onChange={(value) => setForm({ ...form, renewalReminder: value })} />
                <Field label="Signed TA" value={form.signedTa} onChange={(value) => setForm({ ...form, signedTa: value })} wide />
                <TextArea label="Renewal history" value={form.renewalHistory} onChange={(value) => setForm({ ...form, renewalHistory: value })} />
                <TextArea label="Special clauses" value={form.specialClauses} onChange={(value) => setForm({ ...form, specialClauses: value })} />
                <TextArea label="Notes" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} wide />
              </div>

              <button className="primary-button" onClick={saveTenancy} disabled={operationId === 'save-tenancy'}>
                {operationId === 'save-tenancy' ? 'Saving...' : editingTenancyId ? 'Save tenancy' : 'Create tenancy'}
              </button>
            </div>

            <div className="panel">
              <div className="section-title">
                <div>
                  <p className="eyebrow">Portfolio</p>
                  <h2>Active tenancies</h2>
                </div>
                <span className="mini-stat">{currency.format(depositExposure)} deposits</span>
              </div>

              {tenancies.length === 0 ? (
                <EmptyState title="No tenancies yet" body="Create the first tenancy to activate collections and TA memory." />
              ) : (
                <div className="tenancy-list">
                  {tenancies.map((tenancy) => (
                    <article
                      className={`tenancy-card ${selectedTenancy?.id === tenancy.id ? 'is-active' : ''}`}
                      key={tenancy.id}
                      onClick={() => setSelectedTenancyId(tenancy.id)}
                    >
                      <div>
                        <h3>{tenancy.property}</h3>
                        <p>{tenancy.tenant} / {tenancy.landlord}</p>
                      </div>
                      <strong>{currency.format(tenancy.monthlyRental)}</strong>
                      {pendingDeleteId === tenancy.id ? (
                        <div className="card-actions danger-actions">
                          <button onClick={(event) => { event.stopPropagation(); confirmDeleteTenancy(tenancy.id); }}>
                            {operationId === `delete-${tenancy.id}` ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button onClick={(event) => { event.stopPropagation(); setPendingDeleteId(null); }}>Cancel</button>
                        </div>
                      ) : (
                        <div className="card-actions">
                          <button onClick={(event) => { event.stopPropagation(); startEdit(tenancy); }}>Edit</button>
                          <button onClick={(event) => { event.stopPropagation(); setPendingDeleteId(tenancy.id); }}>Delete</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          {selectedTenancy ? (
            <section className="workspace-grid bottom-grid">
              <div className="panel">
                <div className="section-title">
                  <div>
                    <p className="eyebrow">Rental collection</p>
                    <h2>{selectedTenancy.property}</h2>
                  </div>
                  <StatusPill status={selectedCollections[0]?.status ?? 'outstanding'} />
                </div>

                {selectedCollections.length === 0 ? (
                  <div className="empty-state">
                    <h3>No collection records yet</h3>
                    <p>Create this month&apos;s collection record for {selectedTenancy.tenant}.</p>
                    <button className="secondary-button" onClick={() => createCollectionRecord(selectedTenancy)} disabled={operationId !== null}>
                      Create current month
                    </button>
                  </div>
                ) : (
                  selectedCollections.map((collection) => {
                    const balance = Math.max(collection.amountDue - collection.amountPaid, 0);

                    return (
                      <article className="collection-row" key={collection.id}>
                        <div>
                          <h3>{collection.collectionMonth}</h3>
                          <p>Due {collection.dueDate}</p>
                        </div>
                        <div>
                          <strong>{currency.format(collection.amountDue)}</strong>
                          <p>{currency.format(balance)} outstanding</p>
                        </div>
                        <StatusPill status={collection.status} />
                        <div className="payment-box">
                          <input
                            aria-label="Payment amount"
                            inputMode="decimal"
                            min="0"
                            placeholder="Amount"
                            type="number"
                            value={paymentAmount}
                            onChange={(event) => setPaymentAmount(event.target.value)}
                          />
                          <input
                            aria-label="Payment reference"
                            placeholder="Reference"
                            value={paymentReference}
                            onChange={(event) => setPaymentReference(event.target.value)}
                          />
                          <button onClick={() => addPayment(collection)} disabled={balance === 0 || operationId === `payment-${collection.id}`}>
                            {operationId === `payment-${collection.id}` ? 'Recording...' : 'Record payment'}
                          </button>
                        </div>
                        <div className="history-list">
                          {collection.paymentHistory.length === 0 && <p>No payments recorded yet.</p>}
                          {collection.paymentHistory.map((payment) => (
                            <p key={payment.id}>
                              {payment.paidOn} / {currency.format(payment.amount)} / {payment.reference}
                            </p>
                          ))}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              <div className="panel">
                <div className="section-title">
                  <div>
                    <p className="eyebrow">TA memory</p>
                    <h2>Agreement record</h2>
                  </div>
                </div>

                <div className="memory-stack">
                  <MemoryItem label="Signed TA" value={selectedTenancy.signedTa} />
                  <MemoryItem label="Renewal history" value={selectedTenancy.renewalHistory} />
                  <MemoryItem label="Special clauses" value={selectedTenancy.specialClauses} />
                  <MemoryItem label="Notes" value={selectedTenancy.notes} />
                  <MemoryItem label="Renewal reminder" value={selectedTenancy.renewalReminder} />
                </div>
              </div>
            </section>
          ) : (
            <section className="panel bottom-grid">
              <EmptyState title="No tenancy selected" body="Create or select a tenancy to view collections and TA memory." />
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return (
    <div className={`metric ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  wide = false,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  wide?: boolean;
  required?: boolean;
}) {
  return (
    <label className={wide ? 'wide' : ''}>
      <span>{label}</span>
      <input type={type} value={value} required={required} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input type="number" min="0" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function TextArea({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return (
    <label className={wide ? 'wide' : ''}>
      <span>{label}</span>
      <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function StatusPill({ status }: { status: PaymentStatus }) {
  return <span className={`status-pill ${status}`}>{status}</span>;
}

function MemoryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="memory-item">
      <span>{label}</span>
      <p>{value || 'No record yet.'}</p>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="workspace-grid">
      <div className="panel skeleton-panel">
        <div className="skeleton-line short" />
        <div className="skeleton-line" />
        <div className="skeleton-grid">
          <div />
          <div />
          <div />
          <div />
        </div>
      </div>
      <div className="panel skeleton-panel">
        <div className="skeleton-line short" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    </section>
  );
}
