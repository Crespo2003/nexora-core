'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Confidence, TenancyExtraction } from '../lib/ai/tenancyExtractor';
import {
  compareDisplayDates,
  currentIsoDate,
  currentIsoMonth,
  displayDateToIso,
  isoMonthToDisplayMonth,
  isoToDisplayDate
} from '../lib/dates/formatDate';
import { getDocumentTranslations } from '../lib/i18n/documentTranslations';
import { defaultLanguage, getTranslations, languageStorageKey, translateKnownMessage, type Language } from '../lib/i18n/translations';
import { getBrowserSupabaseClient } from '../lib/supabase/browser';

type PaymentStatus = 'paid' | 'partial' | 'outstanding' | 'overdue';
type NoticeTone = 'info' | 'success' | 'error' | 'warning';
type ImportState = 'idle' | 'uploading' | 'parsing' | 'extracting' | 'review' | 'saving' | 'success' | 'failed';
type FieldKey = keyof TenancyForm;

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
  tenantIdNo: string;
  tenantPhone: string;
  tenantEmail: string;
  landlord: string;
  landlordIdNo: string;
  landlordPhone: string;
  landlordEmail: string;
  property: string;
  unitNo: string;
  propertyAddress: string;
  propertyType: string;
  monthlyRental: number;
  securityDeposit: number;
  utilityDeposit: number;
  accessCardDeposit: number;
  carParkRemoteDeposit: number;
  commencementDate: string;
  expiryDate: string;
  renewalOption: string;
  noticePeriod: string;
  renewalReminder: string;
  signedTa: string;
  renewalHistory: string;
  specialClauses: string;
  notes: string;
  status: string;
};

type RentalCollection = {
  id: string;
  tenancyId: string;
  collectionMonth: string;
  dueDate: string;
  rentalAmount: number;
  tnbAmount: number;
  waterAmount: number;
  iwkAmount: number;
  wifiAmount: number;
  aircondAmount: number;
  otherCharges: number;
  totalDue: number;
  amountPaid: number;
  outstandingBalance: number;
  paymentStatus: PaymentStatus;
  paymentDate: string;
  paymentMethod: string;
  paymentReference: string;
  notes: string;
  paymentHistory: PaymentHistory[];
};

type TenancyDocument = {
  id: string;
  tenancyId: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  documentType: string;
  uploadStatus: string;
  uploadedAt: string;
};

type UploadedDocument = {
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  documentType: string;
  uploadStatus: string;
};

type TenancyForm = Omit<Tenancy, 'id' | 'status'>;

type ImportReviewForm = TenancyForm & {
  rawText: string;
  summary: string;
};

const maxUploadBytes = 10 * 1024 * 1024;
const todayIso = currentIsoDate();
const currentMonth = currentIsoMonth();

const currency = new Intl.NumberFormat('en-MY', {
  currency: 'MYR',
  style: 'currency',
  maximumFractionDigits: 0
});

const getSupabaseClient = getBrowserSupabaseClient;

function emptyForm(): TenancyForm {
  const today = isoToDisplayDate(todayIso);

  return {
    tenant: '',
    tenantIdNo: '',
    tenantPhone: '',
    tenantEmail: '',
    landlord: '',
    landlordIdNo: '',
    landlordPhone: '',
    landlordEmail: '',
    property: '',
    unitNo: '',
    propertyAddress: '',
    propertyType: '',
    monthlyRental: 0,
    securityDeposit: 0,
    utilityDeposit: 0,
    accessCardDeposit: 0,
    carParkRemoteDeposit: 0,
    commencementDate: today,
    expiryDate: today,
    renewalOption: '',
    noticePeriod: '',
    renewalReminder: today,
    signedTa: '',
    renewalHistory: '',
    specialClauses: '',
    notes: ''
  };
}

function isMissingTableError(error: unknown): boolean {
  if (typeof error !== 'object' || !error) return false;
  const maybeError = error as { code?: string; message?: string };
  return maybeError.code === '42P01' || /relation .* does not exist/i.test(maybeError.message ?? '');
}

function userError(error: unknown, language: Language): string {
  const t = getTranslations(language);
  if (isMissingTableError(error)) return t.notices.tablesMissing;
  if (typeof error === 'object' && error && 'message' in error) return String(error.message);
  if (error instanceof Error) return error.message;
  return t.errors.unknown;
}

function apiErrorMessage(error: unknown, language: Language): string {
  const t = getTranslations(language);
  const message = String(error ?? '');

  if (message === 'duplicate-tenancy') return t.errors.duplicateTenancy;
  if (message === 'database-unavailable') return t.notices.dbConnect;
  if (message === 'tables-missing') return t.notices.tablesMissing;
  if (message.includes('Supabase server configuration is missing')) return t.notices.dbConnect;
  if (message.includes('No file uploaded')) return t.errors.parseFailed;
  if (message.includes('Unsupported file type')) return t.notices.unsupportedFile;
  if (message.includes('File is too large')) return t.notices.fileTooLarge;
  if (message.includes('Document unavailable')) return t.notices.documentUnavailable;
  if (message.includes('Database tables') || message.includes('relation') || message.includes('does not exist')) return t.notices.tablesMissing;

  return message || t.errors.unknown;
}

function cleanNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function toPaymentStatus(totalDue: number, amountPaid: number, dueDate: string): PaymentStatus {
  if (amountPaid >= totalDue) return 'paid';
  if (amountPaid > 0) return 'partial';
  if (new Date(`${dueDate}T00:00:00`) < new Date(`${todayIso}T00:00:00`)) return 'overdue';
  return 'outstanding';
}

function mapTenancy(row: Record<string, unknown>): Tenancy {
  return {
    id: String(row.id),
    tenant: String(row.tenant ?? ''),
    tenantIdNo: String(row.tenant_id_no ?? ''),
    tenantPhone: String(row.tenant_phone ?? ''),
    tenantEmail: String(row.tenant_email ?? ''),
    landlord: String(row.landlord ?? ''),
    landlordIdNo: String(row.landlord_id_no ?? ''),
    landlordPhone: String(row.landlord_phone ?? ''),
    landlordEmail: String(row.landlord_email ?? ''),
    property: String(row.property ?? ''),
    unitNo: String(row.unit_no ?? ''),
    propertyAddress: String(row.property_address ?? ''),
    propertyType: String(row.property_type ?? ''),
    monthlyRental: cleanNumber(row.monthly_rental),
    securityDeposit: cleanNumber(row.security_deposit ?? row.deposit),
    utilityDeposit: cleanNumber(row.utility_deposit),
    accessCardDeposit: cleanNumber(row.access_card_deposit),
    carParkRemoteDeposit: cleanNumber(row.car_park_remote_deposit),
    commencementDate: String(row.commencement_date ?? todayIso),
    expiryDate: String(row.expiry_date ?? todayIso),
    renewalOption: String(row.renewal_option ?? ''),
    noticePeriod: String(row.notice_period ?? ''),
    renewalReminder: String(row.renewal_reminder ?? ''),
    signedTa: String(row.signed_ta ?? ''),
    renewalHistory: String(row.renewal_history ?? ''),
    specialClauses: String(row.special_clauses ?? ''),
    notes: String(row.notes ?? ''),
    status: String(row.status ?? 'active')
  };
}

function mapCollection(row: Record<string, unknown>): RentalCollection {
  const rentalAmount = cleanNumber(row.rental_amount ?? row.amount_due);
  const totalDue = cleanNumber(row.total_due ?? row.amount_due ?? rentalAmount);
  const amountPaid = cleanNumber(row.amount_paid);
  const dueDate = String(row.due_date ?? todayIso);

  return {
    id: String(row.id),
    tenancyId: String(row.tenancy_id ?? ''),
    collectionMonth: String(row.collection_month ?? '').slice(0, 7),
    dueDate,
    rentalAmount,
    tnbAmount: cleanNumber(row.tnb_amount),
    waterAmount: cleanNumber(row.water_amount),
    iwkAmount: cleanNumber(row.iwk_amount),
    wifiAmount: cleanNumber(row.wifi_amount),
    aircondAmount: cleanNumber(row.aircond_amount),
    otherCharges: cleanNumber(row.other_charges),
    totalDue,
    amountPaid,
    outstandingBalance: cleanNumber(row.outstanding_balance ?? Math.max(totalDue - amountPaid, 0)),
    paymentStatus: String(row.payment_status ?? row.status ?? toPaymentStatus(totalDue, amountPaid, dueDate)) as PaymentStatus,
    paymentDate: String(row.payment_date ?? ''),
    paymentMethod: String(row.payment_method ?? ''),
    paymentReference: String(row.payment_reference ?? ''),
    notes: String(row.notes ?? ''),
    paymentHistory: Array.isArray(row.payment_history) ? (row.payment_history as PaymentHistory[]) : []
  };
}

function formFromTenancy(tenancy: Tenancy): TenancyForm {
  return {
    ...tenancy,
    commencementDate: isoToDisplayDate(tenancy.commencementDate),
    expiryDate: isoToDisplayDate(tenancy.expiryDate),
    renewalReminder: isoToDisplayDate(tenancy.renewalReminder)
  };
}

function tenancyFromForm(form: TenancyForm, id: string): Tenancy {
  return {
    ...form,
    id,
    commencementDate: displayDateToIso(form.commencementDate) ?? todayIso,
    expiryDate: displayDateToIso(form.expiryDate) ?? todayIso,
    renewalReminder: form.renewalReminder ? displayDateToIso(form.renewalReminder) ?? '' : '',
    status: 'active'
  };
}

function tenancyPayload(form: TenancyForm) {
  return {
    tenant: form.tenant.trim(),
    tenant_id_no: form.tenantIdNo.trim(),
    tenant_phone: form.tenantPhone.trim(),
    tenant_email: form.tenantEmail.trim(),
    landlord: form.landlord.trim(),
    landlord_id_no: form.landlordIdNo.trim(),
    landlord_phone: form.landlordPhone.trim(),
    landlord_email: form.landlordEmail.trim(),
    property: form.property.trim(),
    unit_no: form.unitNo.trim(),
    property_address: form.propertyAddress.trim(),
    property_type: form.propertyType.trim(),
    monthly_rental: form.monthlyRental,
    security_deposit: form.securityDeposit,
    utility_deposit: form.utilityDeposit,
    access_card_deposit: form.accessCardDeposit,
    car_park_remote_deposit: form.carParkRemoteDeposit,
    commencement_date: displayDateToIso(form.commencementDate),
    expiry_date: displayDateToIso(form.expiryDate),
    renewal_option: form.renewalOption.trim(),
    notice_period: form.noticePeriod.trim(),
    renewal_reminder: form.renewalReminder ? displayDateToIso(form.renewalReminder) : null,
    signed_ta: form.signedTa.trim(),
    renewal_history: form.renewalHistory.trim(),
    special_clauses: form.specialClauses.trim(),
    notes: form.notes.trim(),
    status: 'active'
  };
}

function collectionForTenancy(tenancy: Tenancy): RentalCollection {
  const dueDate = `${currentMonth}-01`;
  const totalDue = tenancy.monthlyRental;

  return {
    id: `collection-${crypto.randomUUID()}`,
    tenancyId: tenancy.id,
    collectionMonth: currentMonth,
    dueDate,
    rentalAmount: tenancy.monthlyRental,
    tnbAmount: 0,
    waterAmount: 0,
    iwkAmount: 0,
    wifiAmount: 0,
    aircondAmount: 0,
    otherCharges: 0,
    totalDue,
    amountPaid: 0,
    outstandingBalance: totalDue,
    paymentStatus: toPaymentStatus(totalDue, 0, dueDate),
    paymentDate: '',
    paymentMethod: '',
    paymentReference: '',
    notes: '',
    paymentHistory: []
  };
}

function collectionPayload(collection: RentalCollection) {
  return {
    tenancy_id: collection.tenancyId,
    collection_month: `${collection.collectionMonth}-01`,
    due_date: collection.dueDate,
    rental_amount: collection.rentalAmount,
    tnb_amount: collection.tnbAmount,
    water_amount: collection.waterAmount,
    iwk_amount: collection.iwkAmount,
    wifi_amount: collection.wifiAmount,
    aircond_amount: collection.aircondAmount,
    other_charges: collection.otherCharges,
    amount_paid: collection.amountPaid,
    payment_status: collection.paymentStatus,
    payment_date: collection.paymentDate || null,
    payment_method: collection.paymentMethod,
    payment_reference: collection.paymentReference,
    notes: collection.notes,
    payment_history: collection.paymentHistory
  };
}

function collectionPayloadWithoutTenancy(collection: RentalCollection) {
  const { tenancy_id: _tenancyId, ...payload } = collectionPayload(collection) as Record<string, unknown>;
  return payload;
}

function mapDocument(row: Record<string, unknown>): TenancyDocument {
  return {
    id: String(row.id),
    tenancyId: String(row.tenancy_id ?? ''),
    originalFilename: String(row.original_filename ?? ''),
    storagePath: String(row.storage_path ?? ''),
    mimeType: String(row.mime_type ?? ''),
    fileSize: cleanNumber(row.file_size),
    documentType: String(row.document_type ?? ''),
    uploadStatus: String(row.upload_status ?? ''),
    uploadedAt: String(row.uploaded_at ?? '')
  };
}

function validateForm(form: TenancyForm, tenancies: Tenancy[], editingId: string | null, language: Language) {
  const t = getTranslations(language);
  const errors: Partial<Record<FieldKey, string>> = {};
  const required: FieldKey[] = ['tenant', 'landlord', 'property'];
  const moneyFields: FieldKey[] = ['monthlyRental', 'securityDeposit', 'utilityDeposit', 'accessCardDeposit', 'carParkRemoteDeposit'];

  required.forEach((field) => {
    if (!String(form[field]).trim()) errors[field] = t.errors.required;
  });

  moneyFields.forEach((field) => {
    const value = Number(form[field]);
    if (!Number.isFinite(value)) errors[field] = t.errors.numberInvalid;
    else if (value < 0) errors[field] = t.errors.numberNegative;
  });

  if (!form.commencementDate) errors.commencementDate = t.errors.dateRequired;
  else if (!displayDateToIso(form.commencementDate)) errors.commencementDate = t.errors.dateInvalid;

  if (!form.expiryDate) errors.expiryDate = t.errors.dateRequired;
  else if (!displayDateToIso(form.expiryDate)) errors.expiryDate = t.errors.dateInvalid;

  if (form.renewalReminder && !displayDateToIso(form.renewalReminder)) errors.renewalReminder = t.errors.dateInvalid;

  const termCompare = compareDisplayDates(form.expiryDate, form.commencementDate);
  if (termCompare !== null && termCompare <= 0) errors.expiryDate = t.errors.expiryAfterCommencement;

  const reminderVsExpiry = form.renewalReminder ? compareDisplayDates(form.renewalReminder, form.expiryDate) : null;
  if (reminderVsExpiry !== null && reminderVsExpiry >= 0) errors.renewalReminder = t.errors.reminderBeforeExpiry;

  const reminderVsStart = form.renewalReminder ? compareDisplayDates(form.renewalReminder, form.commencementDate) : null;
  if (reminderVsStart !== null && reminderVsStart < 0) errors.renewalReminder = t.errors.reminderAfterCommencement;

  const duplicate = tenancies.some(
    (tenancy) =>
      tenancy.id !== editingId &&
      tenancy.tenant.trim().toLowerCase() === form.tenant.trim().toLowerCase() &&
      tenancy.property.trim().toLowerCase() === form.property.trim().toLowerCase() &&
      tenancy.unitNo.trim().toLowerCase() === form.unitNo.trim().toLowerCase()
  );

  if (duplicate) errors.property = t.errors.duplicateTenancy;
  return errors;
}

function fieldValue(extraction: TenancyExtraction, path: string): string {
  const parts = path.split('.');
  let current: unknown = extraction;
  for (const part of parts) current = (current as Record<string, unknown>)?.[part];
  return String((current as { value?: string })?.value ?? '');
}

function reviewFormFromExtraction(extraction: TenancyExtraction): ImportReviewForm {
  const monthlyRental = cleanNumber(fieldValue(extraction, 'financial.monthlyRental'));

  return {
    ...emptyForm(),
    tenant: fieldValue(extraction, 'tenant.name'),
    tenantIdNo: fieldValue(extraction, 'tenant.idNo'),
    tenantPhone: fieldValue(extraction, 'tenant.phone'),
    tenantEmail: fieldValue(extraction, 'tenant.email'),
    landlord: fieldValue(extraction, 'landlord.name'),
    landlordIdNo: fieldValue(extraction, 'landlord.idNo'),
    landlordPhone: fieldValue(extraction, 'landlord.phone'),
    landlordEmail: fieldValue(extraction, 'landlord.email'),
    property: fieldValue(extraction, 'property.propertyName'),
    unitNo: fieldValue(extraction, 'property.unitNo'),
    propertyAddress: fieldValue(extraction, 'property.fullAddress'),
    propertyType: fieldValue(extraction, 'property.propertyType'),
    monthlyRental,
    securityDeposit: cleanNumber(fieldValue(extraction, 'financial.securityDeposit')),
    utilityDeposit: cleanNumber(fieldValue(extraction, 'financial.utilityDeposit')),
    accessCardDeposit: cleanNumber(fieldValue(extraction, 'financial.accessCardDeposit')),
    carParkRemoteDeposit: cleanNumber(fieldValue(extraction, 'financial.carParkRemoteDeposit')),
    commencementDate: fieldValue(extraction, 'dates.commencementDate') || emptyForm().commencementDate,
    expiryDate: fieldValue(extraction, 'dates.expiryDate') || emptyForm().expiryDate,
    renewalOption: fieldValue(extraction, 'dates.renewalOption'),
    noticePeriod: fieldValue(extraction, 'dates.noticePeriod'),
    renewalReminder: fieldValue(extraction, 'dates.renewalReminder'),
    signedTa: extraction.document.originalFilename,
    renewalHistory: fieldValue(extraction, 'clauses.renewalClause'),
    specialClauses: [
      fieldValue(extraction, 'clauses.specialClauses'),
      fieldValue(extraction, 'clauses.terminationClause'),
      fieldValue(extraction, 'clauses.diplomaticClause')
    ].filter(Boolean).join('\n\n'),
    notes: extraction.summary,
    rawText: extraction.rawText,
    summary: extraction.summary
  };
}

export default function RentalCommandCentre() {
  const [language, setLanguage] = useState<Language>(defaultLanguage);
  const t = getTranslations(language);
  const supabase = useMemo(getSupabaseClient, []);
  const isSupabaseUnavailable = !supabase;
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [collections, setCollections] = useState<RentalCollection[]>([]);
  const [documents, setDocuments] = useState<TenancyDocument[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [selectedTenancyId, setSelectedTenancyId] = useState('');
  const [editingTenancyId, setEditingTenancyId] = useState<string | null>(null);
  const [form, setForm] = useState<TenancyForm>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [notice, setNotice] = useState<Notice>({ tone: isSupabaseUnavailable ? 'warning' : 'info', message: isSupabaseUnavailable ? t.notices.dbConnect : t.notices.connecting });
  const [isLoading, setIsLoading] = useState(!isSupabaseUnavailable);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<TenancyExtraction | null>(null);
  const [reviewForm, setReviewForm] = useState<ImportReviewForm | null>(null);
  const [importErrors, setImportErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [importState, setImportState] = useState<ImportState>('idle');
  const [importFailedStage, setImportFailedStage] = useState('');
  const [uploadedDocument, setUploadedDocument] = useState<UploadedDocument | null>(null);
  const [documentViewStatus, setDocumentViewStatus] = useState('');

  const selectedTenancy = tenancies.find((tenancy) => tenancy.id === selectedTenancyId) ?? tenancies[0] ?? null;
  const selectedCollections = collections.filter((collection) => collection.tenancyId === selectedTenancy?.id);
  const selectedDocuments = documents.filter((document) => document.tenancyId === selectedTenancy?.id);
  const totalMonthlyRental = tenancies.reduce((sum, tenancy) => sum + tenancy.monthlyRental, 0);
  const totalDue = collections.reduce((sum, collection) => sum + collection.totalDue, 0);
  const totalPaid = collections.reduce((sum, collection) => sum + collection.amountPaid, 0);
  const outstandingBalance = Math.max(totalDue - totalPaid, 0);
  const lateCount = collections.filter((collection) => collection.paymentStatus === 'overdue' || collection.paymentStatus === 'partial').length;
  const depositExposure = tenancies.reduce((sum, tenancy) => sum + tenancy.securityDeposit + tenancy.utilityDeposit + tenancy.accessCardDeposit + tenancy.carParkRemoteDeposit, 0);

  useEffect(() => {
    const saved = window.localStorage.getItem(languageStorageKey);
    if (saved === 'en' || saved === 'zh') setLanguage(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(languageStorageKey, language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    setNotice((current) => ({ ...current, message: translateKnownMessage(current.message, language) }));
    setPaymentError((current) => translateKnownMessage(current, language));
    setFieldErrors((current) => (Object.keys(current).length ? validateForm(form, tenancies, editingTenancyId, language) : current));
    setImportErrors((current) => (reviewForm && Object.keys(current).length ? validateForm(reviewForm, tenancies, null, language) : current));
  }, [editingTenancyId, form, language, reviewForm, tenancies]);

  useEffect(() => {
    loadRentalData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRentalData() {
    if (!supabase) return;
    setIsLoading(true);

    try {
      const [
        { data: tenancyRows, error: tenancyError },
        { data: collectionRows, error: collectionError },
        { data: documentRows, error: documentError },
        { data: membershipRows, error: membershipError }
      ] = await Promise.all([
        supabase.from('tenancies').select('*').order('created_at', { ascending: false }),
        supabase.from('rental_collections').select('*').order('collection_month', { ascending: false }),
        supabase.from('tenancy_documents').select('*').order('uploaded_at', { ascending: false }),
        supabase.from('workspace_members').select('workspace_id').eq('status', 'active').limit(1)
      ]);

      if (tenancyError) throw tenancyError;
      if (collectionError) throw collectionError;
      if (documentError) throw documentError;
      if (membershipError) throw membershipError;

      const loadedTenancies = (tenancyRows ?? []).map(mapTenancy);
      const loadedCollections = (collectionRows ?? []).map(mapCollection);
      const loadedDocuments = (documentRows ?? []).map(mapDocument);
      setTenancies(loadedTenancies);
      setCollections(loadedCollections);
      setDocuments(loadedDocuments);
      setWorkspaceId(String(membershipRows?.[0]?.workspace_id ?? ''));
      setSelectedTenancyId(loadedTenancies[0]?.id ?? '');
      setNotice({ tone: 'success', message: loadedTenancies.length ? t.notices.loaded : t.notices.loadedEmpty });
    } catch (error) {
      setTenancies([]);
      setCollections([]);
      setDocuments([]);
      setNotice({ tone: 'error', message: isMissingTableError(error) ? t.notices.tablesMissing : t.notices.dbConnect });
    } finally {
      setIsLoading(false);
    }
  }

  function updateForm<K extends FieldKey>(field: K, value: TenancyForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function updateReview<K extends FieldKey>(field: K, value: TenancyForm[K]) {
    setReviewForm((current) => (current ? { ...current, [field]: value } : current));
    setImportErrors((current) => ({ ...current, [field]: undefined }));
  }

  function resetForm() {
    setEditingTenancyId(null);
    setForm(emptyForm());
    setFieldErrors({});
  }

  async function saveTenancy() {
    const errors = validateForm(form, tenancies, editingTenancyId, language);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setNotice({ tone: 'error', message: Object.values(errors)[0] ?? t.errors.unknown });
      return;
    }

    setOperationId('save-tenancy');

    try {
      if (editingTenancyId) {
        let saved = tenancyFromForm(form, editingTenancyId);
        if (supabase) {
          const { data, error } = await supabase.from('tenancies').update(tenancyPayload(form)).eq('id', editingTenancyId).select('*').single();
          if (error) throw error;
          saved = mapTenancy(data);
        }
        setTenancies((current) => current.map((tenancy) => (tenancy.id === editingTenancyId ? saved : tenancy)));
        setNotice({ tone: 'success', message: t.notices.tenancyUpdated });
      } else {
        let saved = tenancyFromForm(form, `tenancy-${crypto.randomUUID()}`);
        let collection: RentalCollection | null = collectionForTenancy(saved);

        if (supabase) {
          const response = await fetch('/api/tenancies/create-with-collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenancy: tenancyPayload(form),
              collection: collectionPayloadWithoutTenancy(collection)
            })
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(apiErrorMessage(payload.error, language));
          saved = mapTenancy(payload.tenancy);
          collection = mapCollection(payload.collection);
        } else {
          const duplicateCollection = await createCollectionRecord(saved, false);
          collection = duplicateCollection;
        }
        if (!collection) throw new Error(t.notices.collectionNotCreated);
        setTenancies((current) => [saved, ...current]);
        setCollections((current) => [collection, ...current]);
        setSelectedTenancyId(saved.id);
        setNotice({ tone: 'success', message: t.notices.tenancyCreated });
      }
      resetForm();
    } catch (error) {
      setNotice({ tone: 'error', message: userError(error, language) });
    } finally {
      setOperationId(null);
    }
  }

  async function createCollectionRecord(tenancy: Tenancy, updateUi = true): Promise<RentalCollection | null> {
    if (updateUi) setOperationId(`collection-${tenancy.id}`);

    const duplicate = collections.some((collection) => collection.tenancyId === tenancy.id && collection.collectionMonth === currentMonth);
    if (duplicate) {
      setNotice({ tone: 'error', message: t.notices.collectionDuplicate });
      if (updateUi) setOperationId(null);
      return null;
    }

    let collection = collectionForTenancy(tenancy);

    try {
    if (supabase) {
        const { data, error } = await supabase.from('rental_collections').insert({ ...collectionPayload(collection), workspace_id: workspaceId }).select('*').single();
        if (error) throw error;
        collection = mapCollection(data);
      }
      if (updateUi) {
        setCollections((current) => [collection, ...current]);
        setNotice({ tone: 'success', message: t.notices.collectionCreated });
      }
      return collection;
    } catch (error) {
      setNotice({ tone: 'error', message: userError(error, language) });
      return null;
    } finally {
      if (updateUi) setOperationId(null);
    }
  }

  async function confirmDeleteTenancy(id: string) {
    setOperationId(`delete-${id}`);
    try {
      if (supabase) {
        const response = await fetch(`/api/tenancies/${id}`, { method: 'DELETE' });
        const payload = await response.json();
        if (!response.ok) throw new Error(apiErrorMessage(payload.error, language));
      }
      const remaining = tenancies.filter((tenancy) => tenancy.id !== id);
      setTenancies(remaining);
      setCollections((current) => current.filter((collection) => collection.tenancyId !== id));
      setSelectedTenancyId(remaining[0]?.id ?? '');
      setPendingDeleteId(null);
      setNotice({ tone: 'success', message: t.notices.tenancyDeleted });
    } catch (error) {
      setNotice({ tone: 'error', message: userError(error, language) });
    } finally {
      setOperationId(null);
    }
  }

  function startEdit(tenancy: Tenancy) {
    setEditingTenancyId(tenancy.id);
    setForm(formFromTenancy(tenancy));
    setFieldErrors({});
    setSelectedTenancyId(tenancy.id);
    setPendingDeleteId(null);
  }

  async function addPayment(collection: RentalCollection) {
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError(t.errors.paymentPositive);
      setNotice({ tone: 'error', message: t.errors.paymentPositive });
      return;
    }
    if (amount > collection.outstandingBalance) {
      setPaymentError(t.errors.paymentExceeds);
      setNotice({ tone: 'error', message: t.errors.paymentExceeds });
      return;
    }

    setPaymentError('');
    setOperationId(`payment-${collection.id}`);
    try {
      const nextPaid = collection.amountPaid + amount;
      const payment: PaymentHistory = {
        id: `payment-${crypto.randomUUID()}`,
        paidOn: todayIso,
        amount,
        method: 'Manual record',
        reference: paymentReference.trim() || t.notDetected
      };
      const updated: RentalCollection = {
        ...collection,
        amountPaid: nextPaid,
        outstandingBalance: Math.max(collection.totalDue - nextPaid, 0),
        paymentStatus: toPaymentStatus(collection.totalDue, nextPaid, collection.dueDate),
        paymentDate: todayIso,
        paymentMethod: payment.method,
        paymentReference: payment.reference,
        paymentHistory: [payment, ...collection.paymentHistory]
      };

      if (supabase) {
        const { data, error } = await supabase
          .from('rental_collections')
          .update({
            amount_paid: updated.amountPaid,
            payment_status: updated.paymentStatus,
            payment_date: updated.paymentDate,
            payment_method: updated.paymentMethod,
            payment_reference: updated.paymentReference,
            payment_history: updated.paymentHistory
          })
          .eq('id', collection.id)
          .select('*')
          .single();
        if (error) throw error;
        const saved = mapCollection(data);
        setCollections((current) => current.map((item) => (item.id === collection.id ? saved : item)));
      } else {
        setCollections((current) => current.map((item) => (item.id === collection.id ? updated : item)));
      }

      setPaymentAmount('');
      setPaymentReference('');
      setNotice({ tone: 'success', message: t.notices.paymentRecorded });
    } catch (error) {
      setNotice({ tone: 'error', message: userError(error, language) });
    } finally {
      setOperationId(null);
    }
  }

  async function parseImportFile() {
    if (!importFile) return;
    const validType = importFile.type === 'application/pdf' || importFile.name.toLowerCase().endsWith('.pdf') || importFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || importFile.name.toLowerCase().endsWith('.docx');
    if (!validType) {
      setNotice({ tone: 'error', message: t.notices.unsupportedFile });
      return;
    }
    if (importFile.size > maxUploadBytes) {
      setNotice({ tone: 'error', message: t.notices.fileTooLarge });
      return;
    }

    setOperationId('parse-import');
    setImportState('uploading');
    setImportFailedStage('');
    try {
      const body = new FormData();
      body.append('file', importFile);
      const response = await fetch('/api/tenancy-import/upload', { method: 'POST', body });
      setImportState('parsing');
      const payload = await response.json();
      if (!response.ok || !payload.extraction) throw new Error(apiErrorMessage(payload.error ?? t.errors.parseFailed, language));
      setImportState('extracting');
      const parsed = payload.extraction as TenancyExtraction;
      setExtraction(parsed);
      setReviewForm(reviewFormFromExtraction(parsed));
      setUploadedDocument(payload.document);
      setImportErrors({});
      setImportState('review');
      setNotice({ tone: parsed.document.extractionStatus === 'unreadable' ? 'warning' : 'success', message: parsed.document.extractionStatus === 'unreadable' ? t.scannedWarning : t.extractionReady });
    } catch (error) {
      setImportState('failed');
      setImportFailedStage(t.uploadTenancyAgreement);
      setNotice({ tone: 'error', message: `${t.errors.parseFailed} ${userError(error, language)}` });
    } finally {
      setOperationId(null);
    }
  }

  async function confirmImport() {
    if (!reviewForm || !importFile || !extraction) return;
    if (!uploadedDocument) {
      setNotice({ tone: 'error', message: t.notices.documentUnavailable });
      return;
    }
    if (!supabase) {
      setNotice({ tone: 'error', message: t.notices.importNeedsSupabase });
      return;
    }

    const errors = validateForm(reviewForm, tenancies, null, language);
    if (Object.keys(errors).length) {
      setImportErrors(errors);
      setNotice({ tone: 'error', message: Object.values(errors)[0] ?? t.errors.unknown });
      return;
    }

    setOperationId('confirm-import');
    setImportState('saving');
    setImportFailedStage('');
    let failedStage: string = t.importIntoNexora;
    try {
      const localTenancy = tenancyFromForm(reviewForm, `tenancy-${crypto.randomUUID()}`);
      const localCollection = collectionForTenancy(localTenancy);
      const response = await fetch('/api/tenancy-import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenancy: tenancyPayload(reviewForm),
          collection: collectionPayloadWithoutTenancy(localCollection),
          document: uploadedDocument,
          extraction: {
            extractionStatus: extraction.document.extractionStatus,
            extractedJson: reviewForm,
            rawText: reviewForm.rawText,
            aiSummary: reviewForm.summary,
            confidenceJson: extraction,
            extractionError: extraction.document.extractionStatus === 'unreadable' ? t.scannedWarning : null
          }
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        failedStage = String(payload.stage ?? t.importIntoNexora);
        setImportFailedStage(failedStage);
        throw new Error(apiErrorMessage(payload.error, language));
      }

      const savedTenancy = mapTenancy(payload.tenancy);
      const collection = mapCollection(payload.collection);
      const savedDocument = mapDocument(payload.document);
      setTenancies((current) => [savedTenancy, ...current]);
      setCollections((current) => [collection, ...current]);
      setDocuments((current) => [savedDocument, ...current]);
      setSelectedTenancyId(savedTenancy.id);
      setImportFile(null);
      setExtraction(null);
      setReviewForm(null);
      setUploadedDocument(null);
      setImportState('success');
      setNotice({ tone: 'success', message: t.notices.importSaved });
    } catch (error) {
      setImportState('failed');
      setNotice({ tone: 'error', message: `${t.notices.importFailed} ${failedStage}: ${userError(error, language)}` });
    } finally {
      setOperationId(null);
    }
  }

  async function viewDocument(storagePath: string) {
    setDocumentViewStatus(t.loading);

    try {
      const response = await fetch('/api/tenancy-documents/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath })
      });
      const payload = await response.json();
      if (!response.ok || !payload.signedUrl) throw new Error(apiErrorMessage(payload.error ?? t.notices.documentUnavailable, language));
      window.open(payload.signedUrl, '_blank', 'noopener,noreferrer');
      setDocumentViewStatus(t.notices.documentViewReady);
    } catch (error) {
      setDocumentViewStatus(t.notices.documentUnavailable);
      setNotice({ tone: 'error', message: t.notices.documentUnavailable });
    }
  }

  return (
    <main className="command-shell">
      <header className="command-header">
        <div>
          <p className="eyebrow">{t.appTitle} / {t.platformSubtitle} / {t.sprint}</p>
          <h1>{t.rentalCommandCentre}</h1>
          <p className="header-copy">{t.headerCopy}</p>
        </div>
        <div className="header-actions">
          <LanguageToggle language={language} onChange={setLanguage} />
          <nav className="top-nav" aria-label="Primary">
            <a className="ghost-button active" href="/">{t.rentalCommandCentre}</a>
            <a className="ghost-button" href="/documents">{getDocumentTranslations(language).navDocuments}</a>
            <a className="ghost-button" href="/collections">{language === 'zh' ? '智能收款中心' : 'Smart Collection Centre'}</a>
          </nav>
          <div className="live-badge" title={t.connectionStatus}>{isSupabaseUnavailable ? t.notices.dbConnect : t.supabaseLive}</div>
        </div>
      </header>

      <section className="metrics-grid" aria-label={t.dashboard}>
        <Metric label={t.monthlyRental} value={currency.format(totalMonthlyRental)} />
        <Metric label={t.outstandingBalance} value={currency.format(outstandingBalance)} tone={outstandingBalance > 0 ? 'danger' : 'success'} />
        <Metric label={t.collected} value={currency.format(totalPaid)} />
        <Metric label={t.latePartial} value={String(lateCount)} tone={lateCount > 0 ? 'danger' : 'success'} />
      </section>

      <div className={`notice ${notice.tone}`} role="status">{notice.message}</div>

      {isLoading ? (
        <LoadingState title={t.loadingRentalData} body={t.notices.connecting} />
      ) : (
        <>
          <section className="workspace-grid">
            <div className="panel">
              <div className="section-title">
                <div>
                  <p className="eyebrow">{t.uploadTenancyAgreement}</p>
                  <h2>{t.aiTenancyImport}</h2>
                </div>
              </div>
              <div className="upload-zone">
                <input
                  aria-label={t.uploadPdfDocx}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                />
                <h3>{t.dropDocument}</h3>
                <p>{t.supportedFiles}</p>
                {importFile && <p><strong>{t.selectedFile}:</strong> {importFile.name}</p>}
                <button className="secondary-button" onClick={parseImportFile} disabled={!importFile || operationId === 'parse-import'}>
                  {operationId === 'parse-import' ? t.parsingDocument : t.extractDetails}
                </button>
              </div>
              {extraction && (
                <div className="review-stack">
                  <div className="section-title compact">
                    <div>
                      <p className="eyebrow">{t.reviewExtractedDetails}</p>
                      <h2>{t.importIntoNexora}</h2>
                    </div>
                    <ConfidencePill confidence={extraction.document.extractionConfidence} language={language} />
                  </div>
                  {!extraction.advancedAiConfigured && <div className="notice warning">{t.advancedAiUnavailable}</div>}
                  {extraction.document.extractionStatus === 'unreadable' && <div className="notice warning">{t.scannedWarning}</div>}
                  {uploadedDocument && (
                    <div className="document-meta-grid">
                      <MemoryItem label={t.originalFilename} value={uploadedDocument.originalFilename} fallback={t.notDetected} />
                      <MemoryItem label={t.documentType} value={uploadedDocument.documentType} fallback={t.notDetected} />
                      <MemoryItem label={t.fileSize} value={`${Math.round(uploadedDocument.fileSize / 1024)} KB`} fallback={t.notDetected} />
                      <MemoryItem label={t.uploadDate} value={extraction.document.uploadDate} fallback={t.notDetected} />
                      <MemoryItem label={t.extractionStatus} value={extraction.document.extractionStatus === 'unreadable' ? t.extractionFailed : t.extractionReady} fallback={t.notDetected} />
                      <MemoryItem label={t.storageStatus} value={uploadedDocument.uploadStatus} fallback={t.notDetected} />
                    </div>
                  )}
                  {reviewForm && (
                    <TenancyFields
                      form={reviewForm}
                      errors={importErrors}
                      language={language}
                      onChange={updateReview}
                      confidence={extraction}
                    />
                  )}
                  <details className="raw-text">
                    <summary>{t.rawExtractedText}</summary>
                    <pre>{extraction.rawText || t.notDetected}</pre>
                  </details>
                  {importState === 'failed' && <div className="notice error">{t.failedStage}: {importFailedStage || t.importIntoNexora}</div>}
                  <button className="primary-button" onClick={confirmImport} disabled={!reviewForm || operationId === 'confirm-import'}>
                    {operationId === 'confirm-import' ? t.importing : t.confirmImport}
                  </button>
                </div>
              )}
            </div>

            <div className="panel">
              <div className="section-title">
                <div>
                  <p className="eyebrow">{t.editTenancy}</p>
                  <h2>{editingTenancyId ? t.editTenancy : t.createTenancy}</h2>
                </div>
                {editingTenancyId && <button className="ghost-button" onClick={resetForm}>{t.cancel}</button>}
              </div>
              <TenancyFields form={form} errors={fieldErrors} language={language} onChange={updateForm} />
              <button className="primary-button" onClick={saveTenancy} disabled={operationId === 'save-tenancy'}>
                {operationId === 'save-tenancy' ? t.saving : editingTenancyId ? t.saveTenancy : t.createTenancy}
              </button>
            </div>
          </section>

          <section className="workspace-grid bottom-grid">
            <div className="panel">
              <div className="section-title">
                <div>
                  <p className="eyebrow">{t.activeTenancies}</p>
                  <h2>{t.rentalCommandCentre}</h2>
                </div>
                <span className="mini-stat">{currency.format(depositExposure)} {t.deposits}</span>
              </div>
              {tenancies.length === 0 ? (
                <EmptyState title={t.noTenanciesYet} body={t.noTenanciesBody} />
              ) : (
                <div className="tenancy-list">
                  {tenancies.map((tenancy) => (
                    <article className={`tenancy-card ${selectedTenancy?.id === tenancy.id ? 'is-active' : ''}`} key={tenancy.id} onClick={() => setSelectedTenancyId(tenancy.id)}>
                      <div>
                        <h3>{tenancy.property} {tenancy.unitNo && `· ${tenancy.unitNo}`}</h3>
                        <p>{tenancy.tenant} / {tenancy.landlord}</p>
                        <p>{t.commencementDate}: {isoToDisplayDate(tenancy.commencementDate)} · {t.expiryDate}: {isoToDisplayDate(tenancy.expiryDate)}</p>
                      </div>
                      <strong>{currency.format(tenancy.monthlyRental)}</strong>
                      {pendingDeleteId === tenancy.id ? (
                        <div className="delete-confirmation">
                          <p>{t.deleteWarning}</p>
                          <div className="card-actions danger-actions">
                            <button onClick={(event) => { event.stopPropagation(); confirmDeleteTenancy(tenancy.id); }}>{operationId === `delete-${tenancy.id}` ? t.deleting : t.confirm}</button>
                            <button onClick={(event) => { event.stopPropagation(); setPendingDeleteId(null); }}>{t.cancel}</button>
                          </div>
                        </div>
                      ) : (
                        <div className="card-actions">
                          <button title={t.edit} onClick={(event) => { event.stopPropagation(); startEdit(tenancy); }}>{t.edit}</button>
                          <button title={t.deleteTenancy} onClick={(event) => { event.stopPropagation(); setPendingDeleteId(tenancy.id); }}>{t.delete}</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="panel">
              <div className="section-title">
                <div>
                  <p className="eyebrow">{t.rentalCollection}</p>
                  <h2>{selectedTenancy?.property ?? t.noRecordsFound}</h2>
                </div>
                <StatusPill status={selectedCollections[0]?.paymentStatus ?? 'outstanding'} language={language} />
              </div>
              {!selectedTenancy ? (
                <EmptyState title={t.noRecordsFound} body={t.noTenanciesBody} />
              ) : selectedCollections.length === 0 ? (
                <div className="empty-state">
                  <h3>{t.noCollectionRecords}</h3>
                  <button className="secondary-button" onClick={() => createCollectionRecord(selectedTenancy)} disabled={operationId === `collection-${selectedTenancy.id}`}>
                    {operationId === `collection-${selectedTenancy.id}` ? t.loading : t.createCurrentMonth}
                  </button>
                </div>
              ) : (
                selectedCollections.map((collection) => (
                  <article className="collection-row" key={collection.id}>
                    <div>
                      <h3>{isoMonthToDisplayMonth(collection.collectionMonth)}</h3>
                      <p>{t.dueDate}: {isoToDisplayDate(collection.dueDate)}</p>
                    </div>
                    <div className="collection-breakdown">
                      <p>{t.rental}: {currency.format(collection.rentalAmount)}</p>
                      <p>{t.tnb}: {currency.format(collection.tnbAmount)} · {t.water}: {currency.format(collection.waterAmount)}</p>
                      <p>{t.iwk}: {currency.format(collection.iwkAmount)} · {t.wifi}: {currency.format(collection.wifiAmount)}</p>
                      <p>{t.aircondFee}: {currency.format(collection.aircondAmount)} · {t.otherCharges}: {currency.format(collection.otherCharges)}</p>
                    </div>
                    <div>
                      <strong>{currency.format(collection.totalDue)}</strong>
                      <p>{currency.format(collection.outstandingBalance)} {t.outstandingBalance}</p>
                    </div>
                    <StatusPill status={collection.paymentStatus} language={language} />
                    <div className="payment-box">
                      <Field label={t.amountPaid} value={paymentAmount} type="number" placeholder={t.placeholders.amount} error={paymentError} onChange={(value) => { setPaymentAmount(value); setPaymentError(''); }} />
                      <Field label={t.paymentReference} value={paymentReference} placeholder={t.placeholders.reference} onChange={setPaymentReference} />
                      <button onClick={() => addPayment(collection)} disabled={collection.outstandingBalance === 0 || operationId === `payment-${collection.id}`}>
                        {operationId === `payment-${collection.id}` ? t.recording : t.recordPayment}
                      </button>
                    </div>
                    <div className="history-list">
                      <strong>{t.paymentHistory}</strong>
                      {collection.paymentHistory.length === 0 && <p>{t.noPaymentsRecorded}</p>}
                      {collection.paymentHistory.map((payment) => (
                        <p key={payment.id}>{isoToDisplayDate(payment.paidOn)} / {currency.format(payment.amount)} / {payment.reference}</p>
                      ))}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          {selectedTenancy && (
            <section className="panel bottom-grid">
              <div className="section-title">
                <div>
                  <p className="eyebrow">{t.agreementRecord}</p>
                  <h2>{selectedTenancy.property} {selectedTenancy.unitNo}</h2>
                </div>
              </div>
              <div className="memory-stack">
                <MemoryItem label={t.signedTa} value={selectedTenancy.signedTa} fallback={t.notDetected} />
                <MemoryItem label={t.renewalOption} value={selectedTenancy.renewalOption} fallback={t.notDetected} />
                <MemoryItem label={t.noticePeriod} value={selectedTenancy.noticePeriod} fallback={t.notDetected} />
                <MemoryItem label={t.renewalHistory} value={selectedTenancy.renewalHistory} fallback={t.notDetected} />
                <MemoryItem label={t.specialClauses} value={selectedTenancy.specialClauses} fallback={t.notDetected} />
                <MemoryItem label={t.notes} value={selectedTenancy.notes} fallback={t.notDetected} />
                {selectedDocuments.length === 0 ? (
                  <MemoryItem label={t.documentMetadata} value={t.notDetected} fallback={t.notDetected} />
                ) : (
                  selectedDocuments.map((document) => (
                    <div className="memory-item document-record" key={document.id}>
                      <span>{t.documentMetadata}</span>
                      <p>{t.originalFilename}: {document.originalFilename}</p>
                      <p>{t.documentType}: {document.documentType}</p>
                      <p>{t.fileSize}: {Math.round(document.fileSize / 1024)} KB</p>
                      <p>{t.uploadDate}: {isoToDisplayDate(document.uploadedAt.slice(0, 10))}</p>
                      <p>{t.storageStatus}: {document.uploadStatus}</p>
                      <button className="secondary-button" onClick={() => viewDocument(document.storagePath)}>{t.viewDocument}</button>
                    </div>
                  ))
                )}
                {documentViewStatus && <MemoryItem label={t.documentViewingStatus} value={documentViewStatus} fallback={t.notDetected} />}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function LanguageToggle({ language, onChange }: { language: Language; onChange: (language: Language) => void }) {
  return (
    <div className="language-toggle" aria-label={getTranslations(language).language}>
      <button className={language === 'en' ? 'active' : ''} onClick={() => onChange('en')}>EN</button>
      <button className={language === 'zh' ? 'active' : ''} onClick={() => onChange('zh')}>{getTranslations(language).chineseShort}</button>
    </div>
  );
}

function TenancyFields({
  form,
  errors,
  language,
  onChange,
  confidence
}: {
  form: TenancyForm;
  errors: Partial<Record<FieldKey, string>>;
  language: Language;
  onChange: <K extends FieldKey>(field: K, value: TenancyForm[K]) => void;
  confidence?: TenancyExtraction;
}) {
  const t = getTranslations(language);

  return (
    <div className="form-grid">
      <Field label={t.tenantName} value={form.tenant} placeholder={t.placeholders.tenant} error={errors.tenant} onChange={(value) => onChange('tenant', value)} confidence={confidence?.tenant.name.confidence} language={language} required />
      <Field label={t.landlordName} value={form.landlord} placeholder={t.placeholders.landlord} error={errors.landlord} onChange={(value) => onChange('landlord', value)} confidence={confidence?.landlord.name.confidence} language={language} required />
      <Field label={t.propertyName} value={form.property} placeholder={t.placeholders.property} error={errors.property} onChange={(value) => onChange('property', value)} confidence={confidence?.property.propertyName.confidence} language={language} required />
      <Field label={t.unitNo} value={form.unitNo} placeholder={t.placeholders.unitNo} error={errors.unitNo} onChange={(value) => onChange('unitNo', value)} confidence={confidence?.property.unitNo.confidence} language={language} />
      <Field label={t.propertyAddress} value={form.propertyAddress} placeholder={t.placeholders.address} error={errors.propertyAddress} onChange={(value) => onChange('propertyAddress', value)} confidence={confidence?.property.fullAddress.confidence} language={language} wide />
      <Field label={t.propertyType} value={form.propertyType} error={errors.propertyType} onChange={(value) => onChange('propertyType', value)} confidence={confidence?.property.propertyType.confidence} language={language} />
      <NumberField label={t.monthlyRental} value={form.monthlyRental} error={errors.monthlyRental} onChange={(value) => onChange('monthlyRental', value)} confidence={confidence?.financial.monthlyRental.confidence} language={language} />
      <NumberField label={t.securityDeposit} value={form.securityDeposit} error={errors.securityDeposit} onChange={(value) => onChange('securityDeposit', value)} confidence={confidence?.financial.securityDeposit.confidence} language={language} />
      <NumberField label={t.utilityDeposit} value={form.utilityDeposit} error={errors.utilityDeposit} onChange={(value) => onChange('utilityDeposit', value)} confidence={confidence?.financial.utilityDeposit.confidence} language={language} />
      <NumberField label={t.accessCardDeposit} value={form.accessCardDeposit} error={errors.accessCardDeposit} onChange={(value) => onChange('accessCardDeposit', value)} confidence={confidence?.financial.accessCardDeposit.confidence} language={language} />
      <NumberField label={t.carParkRemoteDeposit} value={form.carParkRemoteDeposit} error={errors.carParkRemoteDeposit} onChange={(value) => onChange('carParkRemoteDeposit', value)} confidence={confidence?.financial.carParkRemoteDeposit.confidence} language={language} />
      <Field label={t.commencementDate} value={form.commencementDate} placeholder={t.placeholders.date} error={errors.commencementDate} onChange={(value) => onChange('commencementDate', value)} confidence={confidence?.dates.commencementDate.confidence} language={language} required />
      <Field label={t.expiryDate} value={form.expiryDate} placeholder={t.placeholders.date} error={errors.expiryDate} onChange={(value) => onChange('expiryDate', value)} confidence={confidence?.dates.expiryDate.confidence} language={language} required />
      <Field label={t.renewalReminder} value={form.renewalReminder} placeholder={t.placeholders.date} error={errors.renewalReminder} onChange={(value) => onChange('renewalReminder', value)} confidence={confidence?.dates.renewalReminder.confidence} language={language} />
      <Field label={t.renewalOption} value={form.renewalOption} error={errors.renewalOption} onChange={(value) => onChange('renewalOption', value)} confidence={confidence?.dates.renewalOption.confidence} language={language} />
      <Field label={t.noticePeriod} value={form.noticePeriod} error={errors.noticePeriod} onChange={(value) => onChange('noticePeriod', value)} confidence={confidence?.dates.noticePeriod.confidence} language={language} />
      <Field label={t.tenantIdNo} value={form.tenantIdNo} error={errors.tenantIdNo} onChange={(value) => onChange('tenantIdNo', value)} confidence={confidence?.tenant.idNo.confidence} language={language} />
      <Field label={t.tenantPhone} value={form.tenantPhone} error={errors.tenantPhone} onChange={(value) => onChange('tenantPhone', value)} confidence={confidence?.tenant.phone.confidence} language={language} />
      <Field label={t.tenantEmail} value={form.tenantEmail} error={errors.tenantEmail} onChange={(value) => onChange('tenantEmail', value)} confidence={confidence?.tenant.email.confidence} language={language} />
      <Field label={t.landlordIdNo} value={form.landlordIdNo} error={errors.landlordIdNo} onChange={(value) => onChange('landlordIdNo', value)} confidence={confidence?.landlord.idNo.confidence} language={language} />
      <Field label={t.landlordPhone} value={form.landlordPhone} error={errors.landlordPhone} onChange={(value) => onChange('landlordPhone', value)} confidence={confidence?.landlord.phone.confidence} language={language} />
      <Field label={t.landlordEmail} value={form.landlordEmail} error={errors.landlordEmail} onChange={(value) => onChange('landlordEmail', value)} confidence={confidence?.landlord.email.confidence} language={language} />
      <Field label={t.signedTa} value={form.signedTa} error={errors.signedTa} onChange={(value) => onChange('signedTa', value)} wide />
      <TextArea label={t.renewalHistory} value={form.renewalHistory} error={errors.renewalHistory} onChange={(value) => onChange('renewalHistory', value)} />
      <TextArea label={t.specialClauses} value={form.specialClauses} error={errors.specialClauses} onChange={(value) => onChange('specialClauses', value)} />
      <TextArea label={t.notes} value={form.notes} placeholder={t.placeholders.notes} error={errors.notes} onChange={(value) => onChange('notes', value)} wide />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  wide = false,
  required = false,
  placeholder = '',
  error = '',
  confidence,
  language = 'en'
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  wide?: boolean;
  required?: boolean;
  placeholder?: string;
  error?: string;
  confidence?: Confidence;
  language?: Language;
}) {
  return (
    <label className={wide ? 'wide field' : 'field'}>
      <span>{label}{required ? ' *' : ''}{confidence && <ConfidencePill confidence={confidence} language={language} />}</span>
      <input type={type} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {error && <em>{error}</em>}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  error = '',
  confidence,
  language
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
  confidence?: Confidence;
  language: Language;
}) {
  const t = getTranslations(language);
  return (
    <label className="field">
      <span>{label}{confidence && <ConfidencePill confidence={confidence} language={language} />}</span>
      <input type="number" min="0" placeholder={t.placeholders.amount} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      {error && <em>{error}</em>}
    </label>
  );
}

function TextArea({ label, value, onChange, wide = false, placeholder = '', error = '' }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; placeholder?: string; error?: string }) {
  return (
    <label className={wide ? 'wide field' : 'field'}>
      <span>{label}</span>
      <textarea rows={3} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {error && <em>{error}</em>}
    </label>
  );
}

function ConfidencePill({ confidence, language }: { confidence: Confidence; language: Language }) {
  const t = getTranslations(language);
  const label = confidence === 'high' ? t.high : confidence === 'medium' ? t.medium : t.low;
  return <small className={`confidence ${confidence}`}>{label}</small>;
}

function StatusPill({ status, language }: { status: PaymentStatus; language: Language }) {
  const t = getTranslations(language);
  const label = status === 'paid' ? t.paid : status === 'partial' ? t.partial : status === 'overdue' ? t.overdue : t.outstanding;
  return <span className={`status-pill ${status}`}>{label}</span>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return (
    <div className={`metric ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MemoryItem({ label, value, fallback }: { label: string; value: string; fallback: string }) {
  return (
    <div className="memory-item">
      <span>{label}</span>
      <p>{value || fallback}</p>
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

function LoadingState({ title, body }: { title: string; body: string }) {
  return (
    <section className="workspace-grid">
      <div className="panel skeleton-panel">
        <div className="loader-ring" />
        <h2>{title}</h2>
        <p>{body}</p>
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
