'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import AppNav from './components/AppNav';
import type { Confidence, TenancyExtraction } from '../lib/ai/tenancyExtractor';
import type { DepositEvidence } from '../lib/ai/extractTenancy';
import {
  currentIsoDate,
  currentIsoMonth,
  isoMonthToDisplayMonth,
  isoToDisplayDate,
  normalizeDateForStorage
} from '../lib/dates/formatDate';
import { DateInput } from '../lib/dates/DateInput';
import { getDocumentTranslations } from '../lib/i18n/documentTranslations';
import { defaultLanguage, getTranslations, languageStorageKey, translateKnownMessage, type Language } from '../lib/i18n/translations';
import { getBrowserSupabaseClient } from '../lib/supabase/browser';
import { JsonApiResponseError, readJsonApiResponse } from '../lib/http/jsonResponse';
import { LegalIntelligencePanel } from './legal-intelligence-panel';
import {
  editableTenancyFormFields,
  mapTenancyExtractionToForm,
  mergeMappedFormPreservingEdits,
  normalizeDateForInput,
  type EditableTenancyFormField,
  type MappedMoney,
  type TenancyMappedForm
} from '../lib/tenancy/mapTenancyExtractionToForm';
import { maxTenancyUploadBytes } from '../lib/tenancy/uploadLimits';
import {
  canConfirmReviewedImport,
  parseReviewedDraft,
  serializeReviewedDraft,
  tenancyDraftStorageKey,
  type ExistingTenancyKey
} from '../lib/tenancy/importReview';
import { formatMYR, parseMYR } from '../lib/formatters';
import { normalizePhone } from '../lib/contacts/phone';

type PaymentStatus = 'paid' | 'partial' | 'outstanding' | 'overdue';
type NoticeTone = 'info' | 'success' | 'error' | 'warning';
type ImportState = 'idle' | 'uploading' | 'parsing' | 'extracting' | 'review' | 'saving' | 'success' | 'failed';
type FieldKey = EditableTenancyFormField;

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
  documentHash: string;
};

type TenancyForm = TenancyMappedForm;
type ImportReviewForm = TenancyMappedForm;

const todayIso = currentIsoDate();
const currentMonth = currentIsoMonth();

const currency = { format: (value: unknown) => formatMYR(value) };

const getSupabaseClient = getBrowserSupabaseClient;

type PreparedTenancyUpload = {
  signedUrl: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
};

function uploadToSignedStorage(file: File, upload: PreparedTenancyUpload, onProgress: (progress: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload.signedUrl);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100))));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      let message = 'The file upload could not be completed.';
      try {
        const payload = JSON.parse(xhr.responseText) as { message?: unknown; error?: unknown };
        if (typeof payload.message === 'string') message = payload.message;
        else if (typeof payload.error === 'string') message = payload.error;
      } catch {
        // Keep the safe client-side error if Storage does not return JSON.
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('The file upload connection was interrupted.'));

    // Direct browser-to-Storage upload keeps the 50 MB file out of the Next.js request body.
    const body = new FormData();
    body.append('cacheControl', '3600');
    body.append('', file);
    xhr.send(body);
  });
}

function emptyForm(): TenancyForm {
  return {
    tenantName: '',
    tenantCompany: '',
    tenantIdentification: '',
    tenantPhone: '',
    tenantEmail: '',
    landlordName: '',
    landlordCompany: '',
    landlordIdentification: '',
    landlordPhone: '',
    landlordEmail: '',
    propertyName: '',
    unitNumber: '',
    fullAddress: '',
    propertyType: '',
    buildUp: '',
    landArea: '',
    carParks: '',
    monthlyRental: '',
    securityDeposit: '',
    generalUtilityDeposit: '',
    accessCardDeposit: '',
    carParkRemoteDeposit: '',
    stampDuty: '',
    commencementDate: '',
    expiryDate: '',
    renewalOption: '',
    noticePeriod: '',
    paymentDueDay: '',
    tnbResponsibility: '',
    waterResponsibility: '',
    iwkResponsibility: '',
    wifiResponsibility: '',
    witnesses: '',
    inventory: '',
    latePayment: '',
    termination: '',
    viewingRights: '',
    maintenance: '',
    insurance: '',
    renewalReminder: '',
    signedTa: '',
    renewalHistory: '',
    specialClauses: '',
    notes: '',
    summary: '',
    risks: [],
    warnings: [],
    confidence: 0,
    fieldConfidence: {},
    sourceReferences: {},
    lowConfidenceFields: [],
    rawAiJson: {},
    rawText: '',
    documentId: '',
    workspaceId: ''
  };
}

function safeReadDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearReviewedDraft(workspaceId: string, documentId: string): void {
  try {
    window.localStorage.removeItem(tenancyDraftStorageKey(workspaceId, documentId));
  } catch {
    // Nothing further to do if the device blocks storage access.
  }
}

function isMissingTableError(error: unknown): boolean {
  if (typeof error !== 'object' || !error) return false;
  const maybeError = error as { code?: string; message?: string };
  return maybeError.code === '42P01' || /relation .* does not exist/i.test(maybeError.message ?? '');
}

function userError(error: unknown, language: Language): string {
  const t = getTranslations(language);
  if (isMissingTableError(error)) return t.notices.tablesMissing;
  if (error instanceof JsonApiResponseError) {
    const requestId = error.details.requestId ? ` Request ID: ${error.details.requestId}.` : '';
    return language === 'zh'
      ? `上传端点返回 HTTP ${error.details.status}（${error.details.contentType || '未知内容类型'}）。请检查服务器日志。${requestId}`
      : `The upload endpoint returned HTTP ${error.details.status} (${error.details.contentType || 'unknown content type'}). Check the server logs.${requestId}`;
  }
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

function extractionProviderMessage(extraction: TenancyExtraction, language: Language): string {
  if (extraction.provider === 'openai' && !extraction.fallbackUsed) {
    return language === 'zh'
      ? `AI 提取已成功完成。提供方：OpenAI（${extraction.document.model ?? 'configured model'}）。`
      : `AI extraction completed successfully. Provider: OpenAI (${extraction.document.model ?? 'configured model'}).`;
  }
  const reason = extraction.fallbackReason ?? 'openai_request_failed';
  return language === 'zh'
    ? `已使用确定性备用解析器。原因：${reason}。`
    : `Deterministic fallback used. Reason: ${reason}.`;
}

function cleanNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function displayPhone(value: string): string {
  const normalized = normalizePhone(value);
  return normalized.display || normalized.normalized || value.trim();
}

function toPaymentStatus(totalDue: number, amountPaid: number, dueDate: string): PaymentStatus {
  if (amountPaid >= totalDue) return 'paid';
  if (amountPaid > 0) return 'partial';
  const dueDateIso = normalizeDateForStorage(dueDate);
  if (dueDateIso && dueDateIso < todayIso) return 'overdue';
  return 'outstanding';
}

function mapTenancy(row: Record<string, unknown>): Tenancy {
  return {
    id: String(row.id),
    tenant: String(row.tenant ?? ''),
    tenantIdNo: String(row.tenant_id_no ?? ''),
    tenantPhone: displayPhone(String(row.tenant_phone ?? '')),
    tenantEmail: String(row.tenant_email ?? ''),
    landlord: String(row.landlord ?? ''),
    landlordIdNo: String(row.landlord_id_no ?? ''),
    landlordPhone: displayPhone(String(row.landlord_phone ?? '')),
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
    commencementDate: normalizeDateForInput(String(row.commencement_date ?? '')),
    expiryDate: normalizeDateForInput(String(row.expiry_date ?? '')),
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
    ...emptyForm(),
    tenantName: tenancy.tenant,
    tenantIdentification: tenancy.tenantIdNo,
    tenantPhone: tenancy.tenantPhone,
    tenantEmail: tenancy.tenantEmail,
    landlordName: tenancy.landlord,
    landlordIdentification: tenancy.landlordIdNo,
    landlordPhone: tenancy.landlordPhone,
    landlordEmail: tenancy.landlordEmail,
    propertyName: tenancy.property,
    unitNumber: tenancy.unitNo,
    fullAddress: tenancy.propertyAddress,
    propertyType: tenancy.propertyType,
    monthlyRental: tenancy.monthlyRental,
    securityDeposit: tenancy.securityDeposit,
    generalUtilityDeposit: tenancy.utilityDeposit,
    accessCardDeposit: tenancy.accessCardDeposit,
    carParkRemoteDeposit: tenancy.carParkRemoteDeposit,
    commencementDate: normalizeDateForInput(tenancy.commencementDate),
    expiryDate: normalizeDateForInput(tenancy.expiryDate),
    renewalOption: tenancy.renewalOption,
    noticePeriod: tenancy.noticePeriod,
    renewalReminder: normalizeDateForInput(tenancy.renewalReminder),
    signedTa: tenancy.signedTa,
    renewalHistory: tenancy.renewalHistory,
    specialClauses: tenancy.specialClauses,
    notes: tenancy.notes
  };
}

function tenancyFromForm(form: TenancyForm, id: string): Tenancy {
  return {
    id,
    tenant: form.tenantName,
    tenantIdNo: form.tenantIdentification,
    tenantPhone: form.tenantPhone,
    tenantEmail: form.tenantEmail,
    landlord: form.landlordName,
    landlordIdNo: form.landlordIdentification,
    landlordPhone: form.landlordPhone,
    landlordEmail: form.landlordEmail,
    property: form.propertyName,
    unitNo: form.unitNumber,
    propertyAddress: form.fullAddress,
    propertyType: form.propertyType,
    monthlyRental: moneyForPersistence(form.monthlyRental),
    securityDeposit: moneyForPersistence(form.securityDeposit),
    utilityDeposit: moneyForPersistence(form.generalUtilityDeposit),
    accessCardDeposit: moneyForPersistence(form.accessCardDeposit),
    carParkRemoteDeposit: moneyForPersistence(form.carParkRemoteDeposit),
    commencementDate: normalizeDateForInput(form.commencementDate),
    expiryDate: normalizeDateForInput(form.expiryDate),
    renewalOption: form.renewalOption,
    noticePeriod: form.noticePeriod,
    renewalReminder: normalizeDateForInput(form.renewalReminder),
    signedTa: form.signedTa,
    renewalHistory: form.renewalHistory,
    specialClauses: form.specialClauses,
    notes: form.notes,
    status: 'active'
  };
}

function tenancyPayload(form: TenancyForm) {
  return {
    tenant: form.tenantName.trim(),
    tenant_id_no: form.tenantIdentification.trim(),
    tenant_phone: form.tenantPhone.trim(),
    tenant_email: form.tenantEmail.trim(),
    tenant_company: form.tenantCompany.trim(),
    landlord: form.landlordName.trim(),
    landlord_id_no: form.landlordIdentification.trim(),
    landlord_phone: form.landlordPhone.trim(),
    landlord_email: form.landlordEmail.trim(),
    property: form.propertyName.trim(),
    unit_no: form.unitNumber.trim(),
    property_address: form.fullAddress.trim(),
    property_type: form.propertyType.trim(),
    monthly_rental: moneyForPersistence(form.monthlyRental),
    security_deposit: moneyForPersistence(form.securityDeposit),
    utility_deposit: moneyForPersistence(form.generalUtilityDeposit),
    access_card_deposit: moneyForPersistence(form.accessCardDeposit),
    car_park_remote_deposit: moneyForPersistence(form.carParkRemoteDeposit),
    rental_due_day: Number(form.paymentDueDay) || 1,
    commencement_date: normalizeDateForStorage(form.commencementDate),
    expiry_date: normalizeDateForStorage(form.expiryDate),
    renewal_option: form.renewalOption.trim(),
    notice_period: form.noticePeriod.trim(),
    renewal_reminder: normalizeDateForStorage(form.renewalReminder),
    signed_ta: form.signedTa.trim(),
    renewal_history: form.renewalHistory.trim(),
    special_clauses: form.specialClauses.trim(),
    notes: form.notes.trim(),
    status: 'active'
  };
}

function moneyForPersistence(value: MappedMoney): number {
  return value === '' ? 0 : value;
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
  const required: FieldKey[] = ['tenantName', 'landlordName', 'propertyName'];
  const moneyFields: FieldKey[] = ['monthlyRental', 'securityDeposit', 'generalUtilityDeposit', 'accessCardDeposit', 'carParkRemoteDeposit', 'stampDuty'];

  required.forEach((field) => {
    if (!String(form[field]).trim()) errors[field] = t.errors.required;
  });

  moneyFields.forEach((field) => {
    const value = Number(form[field]);
    if (!Number.isFinite(value)) errors[field] = t.errors.numberInvalid;
    else if (value < 0) errors[field] = t.errors.numberNegative;
  });

  if (!form.commencementDate) errors.commencementDate = t.errors.dateRequired;
  else if (!normalizeDateForStorage(form.commencementDate)) errors.commencementDate = t.errors.dateInvalid;

  if (!form.expiryDate) errors.expiryDate = t.errors.dateRequired;
  else if (!normalizeDateForStorage(form.expiryDate)) errors.expiryDate = t.errors.dateInvalid;

  if (form.renewalReminder && !normalizeDateForStorage(form.renewalReminder)) errors.renewalReminder = t.errors.dateInvalid;

  const termCompare = compareIsoDates(form.expiryDate, form.commencementDate);
  if (termCompare !== null && termCompare <= 0) errors.expiryDate = t.errors.expiryAfterCommencement;

  const reminderVsExpiry = form.renewalReminder ? compareIsoDates(form.renewalReminder, form.expiryDate) : null;
  if (reminderVsExpiry !== null && reminderVsExpiry >= 0) errors.renewalReminder = t.errors.reminderBeforeExpiry;

  const reminderVsStart = form.renewalReminder ? compareIsoDates(form.renewalReminder, form.commencementDate) : null;
  if (reminderVsStart !== null && reminderVsStart < 0) errors.renewalReminder = t.errors.reminderAfterCommencement;

  const duplicate = tenancies.some(
    (tenancy) =>
      tenancy.id !== editingId &&
      tenancy.tenant.trim().toLowerCase() === form.tenantName.trim().toLowerCase() &&
      tenancy.property.trim().toLowerCase() === form.propertyName.trim().toLowerCase() &&
      tenancy.unitNo.trim().toLowerCase() === form.unitNumber.trim().toLowerCase()
  );

  if (duplicate) errors.propertyName = t.errors.duplicateTenancy;
  return errors;
}

function reviewCorrections(extraction: TenancyExtraction, reviewed: ImportReviewForm): Record<string, { extracted: unknown; confirmed: unknown }> {
  const original = mapTenancyExtractionToForm(extraction, { documentId: reviewed.documentId, workspaceId: reviewed.workspaceId });
  return Object.fromEntries(editableTenancyFormFields.flatMap((field) => {
    return original[field] === reviewed[field] ? [] : [[field, { extracted: original[field], confirmed: reviewed[field] }]];
  }));
}

function reviewedValues(form: TenancyForm): Record<string, string | number> {
  return Object.fromEntries(editableTenancyFormFields.map((field) => [field, form[field]]));
}

function compareIsoDates(left: string, right: string): number | null {
  const leftIso = normalizeDateForStorage(left);
  const rightIso = normalizeDateForStorage(right);
  return leftIso && rightIso ? leftIso.localeCompare(rightIso) : null;
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
  const [importedTenancyId, setImportedTenancyId] = useState('');
  const [importFailedStage, setImportFailedStage] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadedDocument, setUploadedDocument] = useState<UploadedDocument | null>(null);
  const [documentViewStatus, setDocumentViewStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [tenancyPage, setTenancyPage] = useState(0);
  const userEditedFields = useRef<Set<EditableTenancyFormField>>(new Set());

  const selectedTenancy = tenancies.find((tenancy) => tenancy.id === selectedTenancyId) ?? tenancies[0] ?? null;
  const selectedCollections = collections.filter((collection) => collection.tenancyId === selectedTenancy?.id);
  const selectedDocuments = documents.filter((document) => document.tenancyId === selectedTenancy?.id);
  const totalMonthlyRental = tenancies.reduce((sum, tenancy) => sum + tenancy.monthlyRental, 0);
  const totalDue = collections.reduce((sum, collection) => sum + collection.totalDue, 0);
  const totalPaid = collections.reduce((sum, collection) => sum + collection.amountPaid, 0);
  const outstandingBalance = Math.max(totalDue - totalPaid, 0);
  const lateCount = collections.filter((collection) => collection.paymentStatus === 'overdue' || collection.paymentStatus === 'partial').length;
  const depositExposure = tenancies.reduce((sum, tenancy) => sum + tenancy.securityDeposit + tenancy.utilityDeposit + tenancy.accessCardDeposit + tenancy.carParkRemoteDeposit, 0);
  const existingTenancyKeys: ExistingTenancyKey[] = tenancies.map((tenancy) => ({ tenant: tenancy.tenant, property: tenancy.property, unitNo: tenancy.unitNo }));
  const filteredTenancies = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return tenancies;
    return tenancies.filter((tenancy) =>
      tenancy.tenant.toLowerCase().includes(q) ||
      tenancy.property.toLowerCase().includes(q) ||
      tenancy.unitNo.toLowerCase().includes(q) ||
      tenancy.landlord.toLowerCase().includes(q)
    );
  }, [tenancies, searchTerm]);
  const tenancyPageCount = Math.max(1, Math.ceil(filteredTenancies.length / 10));
  const safeTenancyPage = Math.min(tenancyPage, tenancyPageCount - 1);
  const pagedTenancies = filteredTenancies.slice(safeTenancyPage * 10, safeTenancyPage * 10 + 10);
  const canImportReviewed = reviewForm ? canConfirmReviewedImport(reviewForm, existingTenancyKeys) : false;
  const importCompleted = importState === 'success' && Boolean(importedTenancyId);

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

  useEffect(() => {
    if (!notice || notice.tone === 'warning') return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

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
    userEditedFields.current.add(field);
    setForm((current) => ({ ...current, [field]: value }));
    if (extraction) setReviewForm((current) => (current ? { ...current, [field]: value } : current));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setImportErrors((current) => ({ ...current, [field]: undefined }));
  }

  function updateReview<K extends FieldKey>(field: K, value: TenancyForm[K]) {
    userEditedFields.current.add(field);
    setReviewForm((current) => (current ? { ...current, [field]: value } : current));
    setForm((current) => ({ ...current, [field]: value }));
    setImportErrors((current) => ({ ...current, [field]: undefined }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function resetForm() {
    setEditingTenancyId(null);
    setForm(emptyForm());
    setFieldErrors({});
    userEditedFields.current.clear();
  }

  async function saveTenancy() {
    if (!editingTenancyId && extraction && reviewForm && uploadedDocument) {
      await confirmImport();
      return;
    }

    const errors = validateForm(form, tenancies, editingTenancyId, language);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      const errorMessages = Object.values(errors).filter(Boolean) as string[];
      const message = errorMessages.length > 1
        ? `${errorMessages.length} ${language === 'zh' ? '个验证错误。' : 'validation errors. '}${errorMessages[0]}`
        : (errorMessages[0] ?? t.errors.unknown);
      setNotice({ tone: 'error', message });
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
    userEditedFields.current.clear();
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
    const validType = importFile.type === 'application/pdf' || importFile.name.toLowerCase().endsWith('.pdf') || importFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || importFile.name.toLowerCase().endsWith('.docx') || importFile.type === 'text/plain' || importFile.name.toLowerCase().endsWith('.txt');
    if (!validType) {
      setNotice({ tone: 'error', message: t.notices.unsupportedFile });
      return;
    }
    if (importFile.size > maxTenancyUploadBytes) {
      setNotice({ tone: 'error', message: t.notices.fileTooLarge });
      return;
    }

    setOperationId('parse-import');
    setImportState('uploading');
    setImportFailedStage('');
    setImportedTenancyId('');
    setUploadProgress(0);
    try {
      const prepareResponse = await fetch('/api/tenancy-import/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare',
          filename: importFile.name,
          mimeType: importFile.type,
          fileSize: importFile.size
        })
      });
      const prepared = await readJsonApiResponse(prepareResponse) as {
        error?: unknown;
        stage?: unknown;
        code?: unknown;
        upload?: PreparedTenancyUpload;
      };
      if (!prepareResponse.ok || !prepared.upload?.signedUrl || !prepared.upload.storagePath) {
        const stage = typeof prepared.stage === 'string' ? prepared.stage : 'upload';
        const code = typeof prepared.code === 'string' ? prepared.code : '';
        const message = apiErrorMessage(prepared.error ?? t.errors.parseFailed, language);
        throw new Error(code ? `[${stage}:${code}] ${message}` : `[${stage}] ${message}`);
      }

      await uploadToSignedStorage(importFile, prepared.upload, setUploadProgress);
      setImportState('parsing');
      const response = await fetch('/api/tenancy-import/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'finalize',
          filename: importFile.name,
          mimeType: prepared.upload.mimeType,
          fileSize: importFile.size,
          storagePath: prepared.upload.storagePath
        })
      });
      const payload = await readJsonApiResponse(response) as {
        error?: unknown;
        stage?: unknown;
        code?: unknown;
        documentId?: unknown;
        extraction?: TenancyExtraction;
        document?: UploadedDocument;
      };
      if (!response.ok || !payload.extraction || !payload.document) {
        const stage = typeof payload.stage === 'string' ? payload.stage : 'unknown';
        const code = typeof payload.code === 'string' ? payload.code : '';
        const message = apiErrorMessage(payload.error ?? t.errors.parseFailed, language);
        throw new Error(code ? `[${stage}:${code}] ${message}` : `[${stage}] ${message}`);
      }
      setImportState('extracting');
      const parsed = payload.extraction as TenancyExtraction;
      const documentId = String(payload.documentId ?? '');
      const mapped = mapTenancyExtractionToForm(parsed, {
        documentId,
        workspaceId
      });
      const merged = mergeMappedFormPreservingEdits(form, mapped, userEditedFields.current);
      const draft = parseReviewedDraft(safeReadDraft(tenancyDraftStorageKey(workspaceId, documentId)));
      const reviewed = draft ? { ...merged, ...draft } : merged;
      setExtraction(parsed);
      setForm(reviewed);
      setReviewForm(reviewed);
      setEditingTenancyId(null);
      setUploadedDocument(payload.document);
      setFieldErrors({});
      setImportErrors({});
      setImportState('review');
      setNotice(
        draft
          ? { tone: 'info', message: t.notices.draftRestored }
          : { tone: parsed.fallbackUsed ? 'warning' : 'success', message: extractionProviderMessage(parsed, language) }
      );
    } catch (error) {
      setImportState('failed');
      setImportFailedStage(t.uploadTenancyAgreement);
      setNotice({ tone: 'error', message: userError(error, language) });
    } finally {
      setUploadProgress(null);
      setOperationId(null);
    }
  }

  async function confirmImport() {
    if (operationId === 'confirm-import' || importState === 'saving') return;
    if (importCompleted) {
      setNotice({ tone: 'info', message: t.notices.importAlreadyCompleted });
      return;
    }
    if (!reviewForm || !importFile || !extraction) return;
    if (!uploadedDocument) {
      setNotice({ tone: 'error', message: t.notices.documentUnavailable });
      return;
    }
    if (!supabase) {
      setNotice({ tone: 'error', message: t.notices.importNeedsSupabase });
      return;
    }

    const errors = validateForm(form, tenancies, null, language);
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
      const localTenancy = tenancyFromForm(form, `tenancy-${crypto.randomUUID()}`);
      const localCollection = collectionForTenancy(localTenancy);
      const response = await fetch('/api/tenancy-import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          documentId: form.documentId,
          tenancy: tenancyPayload(form),
          collection: collectionPayloadWithoutTenancy(localCollection),
          document: uploadedDocument,
          extraction: {
            extractionStatus: extraction.document.extractionStatus,
            extractedJson: extraction.legalIntelligence,
            rawText: form.rawText,
            aiSummary: form.summary,
            confidenceJson: {
              provider: extraction.provider,
              model: extraction.document.model,
              overallConfidence: form.confidence,
              fieldConfidence: form.fieldConfidence,
              sourceReferences: form.sourceReferences,
              lowConfidenceFields: form.lowConfidenceFields,
              finalReviewedValues: reviewedValues(form),
              userCorrections: reviewCorrections(extraction, form),
              documentId: form.documentId,
              workspaceId
            },
            extractionError: extraction.document.extractionStatus === 'unreadable' ? t.scannedWarning : null,
            model: extraction.document.model
          }
        })
      });
      const payload = await readJsonApiResponse(response) as {
        error?: unknown;
        stage?: unknown;
        tenancy: Record<string, unknown>;
        document: Record<string, unknown>;
        extraction: Record<string, unknown>;
        collection: Record<string, unknown>;
      };
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
      // Refresh the Rental Command Centre so the dashboard totals reflect the new record.
      await loadRentalData();
      setSelectedTenancyId(savedTenancy.id);
      setImportedTenancyId(savedTenancy.id);
      clearReviewedDraft(workspaceId, form.documentId);
      // Keep the reviewed panel mounted so it can present the imported success state and Open Tenancy action.
      setImportState('success');
      setImportErrors({});
      setNotice({ tone: 'success', message: t.notices.importSuccess });
    } catch (error) {
      setImportState('failed');
      setNotice({ tone: 'error', message: `${t.notices.importFailed} ${failedStage}: ${userError(error, language)}` });
    } finally {
      setOperationId(null);
    }
  }

  function saveDraft() {
    if (!reviewForm) return;
    try {
      window.localStorage.setItem(tenancyDraftStorageKey(workspaceId, reviewForm.documentId), serializeReviewedDraft(reviewForm));
    } catch {
      // A blocked or full localStorage still leaves the reviewed values in memory for this session.
    }
    setNotice({ tone: 'success', message: t.notices.draftSaved });
  }

  function resetImport() {
    setImportFile(null);
    setExtraction(null);
    setReviewForm(null);
    setUploadedDocument(null);
    setImportedTenancyId('');
    setImportErrors({});
    setImportFailedStage('');
    setUploadProgress(null);
    setImportState('idle');
    userEditedFields.current.clear();
    resetForm();
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
        <AppNav activePage="tenancies">
          <LanguageToggle language={language} onChange={setLanguage} />
          <div className="live-badge" title={t.connectionStatus}>{isSupabaseUnavailable ? t.notices.dbConnect : t.supabaseLive}</div>
        </AppNav>
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
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={(event) => { setImportFile(event.target.files?.[0] ?? null); setUploadProgress(null); }}
                />
                <h3>{t.dropDocument}</h3>
                <p>{t.supportedFiles} {language === 'zh' ? '最大 50 MB。' : 'Maximum 50 MB.'}</p>
                {importFile && <p><strong>{t.selectedFile}:</strong> {importFile.name}</p>}
                {uploadProgress !== null && (
                  <div aria-live="polite">
                    <div className="progress-track"><span style={{ width: `${uploadProgress}%` }} /></div>
                    <p>{language === 'zh' ? `正在上传：${uploadProgress}%` : `Uploading: ${uploadProgress}%`}</p>
                  </div>
                )}
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
                  <div className={`notice ${extraction.fallbackUsed ? 'warning' : 'success'}`}>{extractionProviderMessage(extraction, language)}</div>
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
                    <>
                      <TenancyFields
                        form={reviewForm}
                        errors={importErrors}
                        language={language}
                        onChange={updateReview}
                        fieldConfidence={reviewForm.fieldConfidence}
                      />
                      <ExtractionReviewDetails mapped={reviewForm} extraction={extraction} fallback={t.notDetected} />
                      <LegalIntelligencePanel extraction={extraction.legalIntelligence} rawText={extraction.rawText} />
                    </>
                  )}
                  <details className="raw-text">
                    <summary>{t.rawExtractedText}</summary>
                    <pre>{extraction.rawText || t.notDetected}</pre>
                  </details>
                  {importState === 'failed' && <div className="notice error">{t.failedStage}: {importFailedStage || t.importIntoNexora}</div>}
                  {importCompleted ? (
                    <div className="import-success" role="status">
                      <div className="notice success">{t.notices.importSuccess}</div>
                      <div className="document-meta-grid">
                        <MemoryItem label={t.extractionStatus} value={t.importedStatus} fallback={t.notDetected} />
                        <MemoryItem label={t.tenancyReference} value={importedTenancyId} fallback={t.notDetected} />
                      </div>
                      <div className="import-actions">
                        <a className="primary-button" href={`/tenancies/${importedTenancyId}`}>{t.openTenancy}</a>
                        {uploadedDocument && (
                          <button className="secondary-button" onClick={() => viewDocument(uploadedDocument.storagePath)}>{t.viewDocument}</button>
                        )}
                        <button className="ghost-button" onClick={resetImport}>{t.startNewImport}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="import-actions">
                      <button className="primary-button" onClick={confirmImport} disabled={!reviewForm || !canImportReviewed || operationId === 'confirm-import'}>
                        {operationId === 'confirm-import' ? t.importing : t.importIntoNexora}
                      </button>
                      <button className="secondary-button" onClick={saveDraft} disabled={!reviewForm || operationId === 'confirm-import'}>
                        {t.saveAsDraft}
                      </button>
                    </div>
                  )}
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
              <TenancyFields form={form} errors={fieldErrors} language={language} onChange={updateForm} fieldConfidence={extraction ? form.fieldConfidence : undefined} />
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
                <>
                  <input
                    type="search"
                    value={searchTerm}
                    placeholder={language === 'zh' ? '搜索租约、租客、房产...' : 'Search by tenant, property, unit, landlord...'}
                    onChange={(e) => { setSearchTerm(e.target.value); setTenancyPage(0); }}
                    style={{ marginBottom: 12 }}
                  />
                  {filteredTenancies.length === 0 && searchTerm.trim() ? (
                    <EmptyState title={language === 'zh' ? '没有匹配结果' : 'No matches'} body={language === 'zh' ? '请调整搜索关键词。' : 'Adjust your search term and try again.'} />
                  ) : (
                    <div className="tenancy-list">
                      {pagedTenancies.map((tenancy) => {
                        const expiry = normalizeDateForStorage(tenancy.expiryDate);
                        const daysToExpiry = expiry ? Math.ceil((new Date(`${expiry}T00:00:00Z`).getTime() - new Date(`${todayIso}T00:00:00Z`).getTime()) / 86400000) : null;
                        return (
                          <article className={`tenancy-card ${selectedTenancy?.id === tenancy.id ? 'is-active' : ''}`} key={tenancy.id} onClick={() => setSelectedTenancyId(tenancy.id)}>
                            <div>
                              <h3>
                                {tenancy.property} {tenancy.unitNo && `· ${tenancy.unitNo}`}
                                {daysToExpiry !== null && daysToExpiry < 0 && (
                                  <span className="status-pill overdue" style={{ marginLeft: 8, fontSize: 10 }}>{language === 'zh' ? '已过期' : 'Expired'}</span>
                                )}
                                {daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 30 && (
                                  <span className="status-pill overdue" style={{ marginLeft: 8, fontSize: 10 }}>{language === 'zh' ? `${daysToExpiry}天` : `Exp ${daysToExpiry}d`}</span>
                                )}
                                {daysToExpiry !== null && daysToExpiry > 30 && daysToExpiry <= 90 && (
                                  <span className="status-pill partial" style={{ marginLeft: 8, fontSize: 10 }}>{language === 'zh' ? `${daysToExpiry}天` : `Exp ${daysToExpiry}d`}</span>
                                )}
                              </h3>
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
                        );
                      })}
                    </div>
                  )}
                  {tenancyPageCount > 1 && (
                    <div className="tenancy-pagination">
                      <button className="ghost-button" style={{ marginTop: 0, minWidth: 36 }} onClick={() => setTenancyPage((p) => Math.max(0, p - 1))} disabled={safeTenancyPage === 0}>&#8592;</button>
                      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{safeTenancyPage + 1} / {tenancyPageCount}</span>
                      <button className="ghost-button" style={{ marginTop: 0, minWidth: 36 }} onClick={() => setTenancyPage((p) => Math.min(tenancyPageCount - 1, p + 1))} disabled={safeTenancyPage === tenancyPageCount - 1}>&#8594;</button>
                    </div>
                  )}
                </>
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
  fieldConfidence
}: {
  form: TenancyForm;
  errors: Partial<Record<FieldKey, string>>;
  language: Language;
  onChange: <K extends FieldKey>(field: K, value: TenancyForm[K]) => void;
  fieldConfidence?: Record<string, number>;
}) {
  const t = getTranslations(language);

  return (
    <div className="form-grid">
      <Field label={t.tenantName} value={form.tenantName} placeholder={t.placeholders.tenant} error={errors.tenantName} onChange={(value) => onChange('tenantName', value)} confidence={confidenceFor(fieldConfidence, 'tenant.name')} language={language} required />
      <Field label={t.landlordName} value={form.landlordName} placeholder={t.placeholders.landlord} error={errors.landlordName} onChange={(value) => onChange('landlordName', value)} confidence={confidenceFor(fieldConfidence, 'landlord.name')} language={language} required />
      <Field label={t.propertyName} value={form.propertyName} placeholder={t.placeholders.property} error={errors.propertyName} onChange={(value) => onChange('propertyName', value)} confidence={confidenceFor(fieldConfidence, 'property.name')} language={language} required />
      <Field label={t.unitNo} value={form.unitNumber} placeholder={t.placeholders.unitNo} error={errors.unitNumber} onChange={(value) => onChange('unitNumber', value)} confidence={confidenceFor(fieldConfidence, 'property.unit')} language={language} />
      <Field label={t.propertyAddress} value={form.fullAddress} placeholder={t.placeholders.address} error={errors.fullAddress} onChange={(value) => onChange('fullAddress', value)} confidence={confidenceFor(fieldConfidence, 'property.address')} language={language} wide />
      <Field label={t.propertyType} value={form.propertyType} error={errors.propertyType} onChange={(value) => onChange('propertyType', value)} confidence={confidenceFor(fieldConfidence, 'property.type')} language={language} />
      <NumberField label={t.monthlyRental} value={form.monthlyRental} error={errors.monthlyRental} onChange={(value) => onChange('monthlyRental', value)} confidence={confidenceFor(fieldConfidence, 'financial.monthly_rental')} language={language} />
      <NumberField label={t.securityDeposit} value={form.securityDeposit} error={errors.securityDeposit} onChange={(value) => onChange('securityDeposit', value)} confidence={confidenceFor(fieldConfidence, 'financial.security_deposit')} language={language} />
      <NumberField label={t.utilityDeposit} value={form.generalUtilityDeposit} error={errors.generalUtilityDeposit} onChange={(value) => onChange('generalUtilityDeposit', value)} confidence={confidenceFor(fieldConfidence, 'financial.utility_deposit')} language={language} />
      <NumberField label={t.accessCardDeposit} value={form.accessCardDeposit} error={errors.accessCardDeposit} onChange={(value) => onChange('accessCardDeposit', value)} confidence={confidenceFor(fieldConfidence, 'financial.access_card_deposit')} language={language} />
      <NumberField label={t.carParkRemoteDeposit} value={form.carParkRemoteDeposit} error={errors.carParkRemoteDeposit} onChange={(value) => onChange('carParkRemoteDeposit', value)} confidence={confidenceFor(fieldConfidence, 'financial.car_park_deposit')} language={language} />
      <Field type="date" label={t.commencementDate} value={form.commencementDate} error={errors.commencementDate} onChange={(value) => onChange('commencementDate', value)} confidence={confidenceFor(fieldConfidence, 'tenancy.commencement_date')} language={language} required />
      <Field type="date" label={t.expiryDate} value={form.expiryDate} error={errors.expiryDate} onChange={(value) => onChange('expiryDate', value)} confidence={confidenceFor(fieldConfidence, 'tenancy.expiry_date')} language={language} required />
      <Field type="date" label={t.renewalReminder} value={form.renewalReminder} error={errors.renewalReminder} onChange={(value) => onChange('renewalReminder', value)} confidence={confidenceFor(fieldConfidence, 'tenancy.renewal_option')} language={language} />
      <Field label={t.renewalOption} value={form.renewalOption} error={errors.renewalOption} onChange={(value) => onChange('renewalOption', value)} confidence={confidenceFor(fieldConfidence, 'tenancy.renewal_option')} language={language} wide multiline />
      <Field label={t.noticePeriod} value={form.noticePeriod} error={errors.noticePeriod} onChange={(value) => onChange('noticePeriod', value)} confidence={confidenceFor(fieldConfidence, 'tenancy.notice_period')} language={language} />
      <Field label={t.tenantIdNo} value={form.tenantIdentification} error={errors.tenantIdentification} onChange={(value) => onChange('tenantIdentification', value)} confidence={confidenceFor(fieldConfidence, 'tenant.ic_passport')} language={language} />
      <Field label={t.tenantPhone} value={form.tenantPhone} error={errors.tenantPhone} onChange={(value) => onChange('tenantPhone', value)} confidence={confidenceFor(fieldConfidence, 'tenant.phone')} language={language} />
      <Field label={t.tenantEmail} value={form.tenantEmail} error={errors.tenantEmail} onChange={(value) => onChange('tenantEmail', value)} confidence={confidenceFor(fieldConfidence, 'tenant.email')} language={language} />
      <Field label={t.landlordIdNo} value={form.landlordIdentification} error={errors.landlordIdentification} onChange={(value) => onChange('landlordIdentification', value)} confidence={confidenceFor(fieldConfidence, 'landlord.ic_passport')} language={language} />
      <Field label={t.landlordPhone} value={form.landlordPhone} error={errors.landlordPhone} onChange={(value) => onChange('landlordPhone', value)} confidence={confidenceFor(fieldConfidence, 'landlord.phone')} language={language} />
      <Field label={t.landlordEmail} value={form.landlordEmail} error={errors.landlordEmail} onChange={(value) => onChange('landlordEmail', value)} confidence={confidenceFor(fieldConfidence, 'landlord.email')} language={language} />
      <Field label={t.signedTa} value={form.signedTa} error={errors.signedTa} onChange={(value) => onChange('signedTa', value)} wide />
      <TextArea label={t.renewalHistory} value={form.renewalHistory} error={errors.renewalHistory} onChange={(value) => onChange('renewalHistory', value)} />
      <TextArea label={t.specialClauses} value={form.specialClauses} error={errors.specialClauses} onChange={(value) => onChange('specialClauses', value)} />
      <TextArea label={t.notes} value={form.notes} placeholder={t.placeholders.notes} error={errors.notes} onChange={(value) => onChange('notes', value)} wide />
    </div>
  );
}

function ExtractionReviewDetails({ mapped, extraction, fallback }: { mapped: TenancyMappedForm; extraction: TenancyExtraction; fallback: string }) {
  const evidence = Object.entries(mapped.sourceReferences).flatMap(([path, source]) => {
    if (!source || typeof source !== 'object') return [];
    const item = source as { source_page?: number | null; source_excerpt?: string; confidence?: number };
    const excerpt = String(item.source_excerpt ?? '').trim();
    if (!excerpt) return [];
    return [{ path, page: item.source_page, excerpt, confidence: item.confidence }];
  });
  const additional = extraction.legalIntelligence;
  const contacts = additional.contacts ?? [];
  const presentClauses = Object.entries(additional.clause_coverage ?? {}).filter(([, present]) => present).map(([name]) => name.replaceAll('_', ' '));
  const payment = additional.payment;
  const parking = additional.parking;
  const inventory = additional.inventory;
  const deposits = additional.deposit_details;
  const depositFields: Array<[string, DepositEvidence]> = deposits ? [
    ['Security', deposits.security_deposit], ['Utility', deposits.utility_deposit], ['Access card', deposits.access_card_deposit],
    ['Car park', deposits.car_park_deposit], ['Key', deposits.key_deposit], ['Renovation', deposits.renovation_deposit],
    ...deposits.other_deposits.map((item) => [item.label, item] as [string, DepositEvidence])
  ] : [];
  const depositEvidence = depositFields.filter(([, item]) => item.amount !== null || item.source_excerpt || item.requires_review).map(([label, item]) =>
    `${label}: ${item.amount === null ? 'Not found' : formatMYR(item.amount)} (${item.basis}${item.rental_multiple !== null ? `, ${item.rental_multiple} month rental` : ''}${item.calculated_amount !== null ? `, calculated ${formatMYR(item.calculated_amount)}` : ''}${item.requires_review ? ', Requires confirmation' : ''}${item.source_page ? `, page ${item.source_page}` : ''})`
  );
  const notice = additional.notice_details;
  return (
    <div className="memory-stack">
      <MemoryItem label="AI provider" value={extraction.provider} fallback={fallback} />
      <MemoryItem label="Model" value={extraction.document.model ?? ''} fallback={fallback} />
      <MemoryItem label="Overall confidence" value={`${Math.round(mapped.confidence * 100)}%`} fallback={fallback} />
      <MemoryItem label="AI summary" value={mapped.summary} fallback={fallback} />
      <MemoryItem label="Risks" value={mapped.risks.map(renderReviewRisk).filter(Boolean).join('\n')} fallback={fallback} />
      <MemoryItem label="Warnings" value={mapped.warnings.join('\n')} fallback={fallback} />
      <MemoryItem label="Low-confidence fields" value={mapped.lowConfidenceFields.join(', ')} fallback={fallback} />
      <details className="raw-text">
        <summary>Source references</summary>
        {evidence.length ? evidence.map((item) => (
          <p key={item.path}>
            <strong>{item.path}</strong>{item.confidence === undefined ? '' : ` (${item.confidence}%)`}
            {item.page ? ` - page ${item.page}` : ''}: {item.excerpt}
          </p>
        )) : <p>{fallback}</p>}
      </details>
      <details className="raw-text">
        <summary>Extended tenancy intelligence</summary>
        <p><strong>Property:</strong> {[additional.property.street, additional.property.postcode, additional.property.city, additional.property.state, additional.property.country].filter(Boolean).join(', ') || fallback}</p>
        <p><strong>Payment:</strong> {[payment?.method, payment?.bank_name, payment?.account_number, payment?.account_holder, payment?.late_payment_interest, payment?.grace_period].filter(Boolean).join(' · ') || fallback}</p>
        <p><strong>Parking and access:</strong> {[parking?.bays, parking?.bay_numbers, parking?.access_cards, parking?.remote_controls, parking?.keys].filter(Boolean).join(' · ') || fallback}</p>
        <p><strong>Inventory:</strong> {inventory?.items?.join(', ') || inventory?.furnished || fallback}</p>
        <p><strong>Clauses present:</strong> {presentClauses.join(', ') || fallback}</p>
        <p><strong>Deposits:</strong> {depositEvidence.join(' · ') || fallback}</p>
        <p><strong>Notice:</strong> {notice?.primary_notice_period ? `${notice.notice_type.replace('_', ' ')}: ${notice.primary_notice_period}${notice.source_page ? ` (page ${notice.source_page})` : ''}` : 'Missing from document'}{notice?.other_notice_periods.length ? ` · Other: ${notice.other_notice_periods.map((item) => `${item.notice_type.replaceAll('_', ' ')} ${item.period}${item.source_page ? ` (page ${item.source_page})` : ''}`).join(', ')}` : ''}</p>
        <p><strong>Contacts:</strong> {contacts.map((contact) => `${contact.role}: ${contact.name || contact.company}${contact.source_page ? ` (page ${contact.source_page})` : ''}`).join(' · ') || fallback}</p>
      </details>
    </div>
  );
}

function confidenceFor(fieldConfidence: Record<string, number> | undefined, path: string): Confidence | undefined {
  const value = fieldConfidence?.[path];
  if (value === undefined) return undefined;
  return value >= 70 ? 'high' : value >= 40 ? 'medium' : 'low';
}

function renderReviewRisk(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const risk = input as { severity?: string; reason?: string; recommendation?: string };
  const reason = String(risk.reason ?? '').trim();
  if (!reason) return '';
  const severity = String(risk.severity ?? '').trim().toUpperCase();
  const recommendation = String(risk.recommendation ?? '').trim();
  return `${severity ? `[${severity}] ` : ''}${reason}${recommendation ? ` Recommendation: ${recommendation}` : ''}`;
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  wide = false,
  multiline = false,
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
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
  error?: string;
  confidence?: Confidence;
  language?: Language;
}) {
  const confidenceClass = confidence === 'low' ? 'critical-confidence' : confidence === 'medium' ? 'review-confidence' : '';
  return (
    <label className={`${wide ? 'wide field' : 'field'} ${confidenceClass}`}>
      <span>{label}{required ? ' *' : ''}{confidence && <ConfidencePill confidence={confidence} language={language} />}</span>
      {multiline
        ? <textarea rows={3} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        : type === 'date'
        ? <DateInput value={value} required={required} placeholder={placeholder || 'DD/MM/YYYY'} onValueChange={onChange} />
        : <input type={type} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}
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
  value: MappedMoney;
  onChange: (value: MappedMoney) => void;
  error?: string;
  confidence?: Confidence;
  language: Language;
}) {
  const t = getTranslations(language);
  const [focused, setFocused] = useState(false);
  const editingValue = value === '' ? '' : String(value);
  const confidenceClass = confidence === 'low' ? 'critical-confidence' : confidence === 'medium' ? 'review-confidence' : '';
  return (
    <label className={`field ${confidenceClass}`}>
      <span>{label}{confidence && <ConfidencePill confidence={confidence} language={language} />}</span>
      <input type="text" inputMode="decimal" placeholder={t.placeholders.amount} value={focused ? editingValue : formatMYR(value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(event) => { const amount = parseMYR(event.target.value); onChange(event.target.value === '' ? '' : amount ?? value); }} />
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
