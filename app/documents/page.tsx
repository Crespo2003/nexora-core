'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TenancyExtraction } from '../../lib/ai/tenancyExtractor';
import { displayDateToIso, isoToDisplayDate } from '../../lib/dates/formatDate';
import type { DocumentExtractionRecord, DocumentRecord, DocumentType, ProcessingStatus, UploadQueueItem } from '../../lib/documents/types';
import { documentTypes } from '../../lib/documents/types';
import { validateDocumentFile } from '../../lib/documents/upload';
import { formatMYR } from '../../lib/formatters';
import { defaultLanguage, languageStorageKey, type Language } from '../../lib/i18n/translations';
import { getDocumentTranslations } from '../../lib/i18n/documentTranslations';
import { getBrowserSupabaseClient } from '../../lib/supabase/browser';

type NoticeTone = 'info' | 'success' | 'error' | 'warning';

type Notice = {
  tone: NoticeTone;
  message: string;
};

type QueueItem = UploadQueueItem & {
  documentType: DocumentType;
  duplicateWarning: boolean;
};

type DocumentWithExtraction = DocumentRecord & {
  extraction?: DocumentExtractionRecord;
};

type ReviewForm = {
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
  renewalReminder: string;
  renewalOption: string;
  noticePeriod: string;
  renewalHistory: string;
  specialClauses: string;
  notes: string;
  originalFilename: string;
};

type Filters = {
  query: string;
  documentType: 'all' | DocumentType;
  processingStatus: 'all' | ProcessingStatus;
  linkedStatus: 'all' | 'linked' | 'unlinked';
  fromDate: string;
  toDate: string;
};

const processingStatuses: ProcessingStatus[] = [
  'uploaded',
  'pending_review',
  'extracting',
  'extraction_completed',
  'extraction_failed',
  'ocr_required',
  'imported',
  'draft'
];

const getSupabaseClient = getBrowserSupabaseClient;

function cleanNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function mapExtraction(row: Record<string, unknown>): DocumentExtractionRecord {
  return {
    id: String(row.id),
    documentId: String(row.document_id ?? ''),
    extractionVersion: String(row.extraction_version ?? ''),
    rawText: String(row.raw_text ?? ''),
    extractedJson: row.extracted_json ?? {},
    confidenceJson: row.confidence_json ?? {},
    aiSummary: String(row.ai_summary ?? ''),
    extractionStatus: String(row.extraction_status ?? 'uploaded') as ProcessingStatus,
    extractionError: String(row.extraction_error ?? ''),
    startedAt: String(row.started_at ?? ''),
    completedAt: String(row.completed_at ?? '')
  };
}

function mapDocument(row: Record<string, unknown>): DocumentWithExtraction {
  const extractions = Array.isArray(row.document_extractions) ? row.document_extractions as Record<string, unknown>[] : [];

  return {
    id: String(row.id),
    originalFilename: String(row.original_filename ?? ''),
    sanitizedFilename: String(row.sanitized_filename ?? ''),
    storageBucket: String(row.storage_bucket ?? ''),
    storagePath: String(row.storage_path ?? ''),
    mimeType: String(row.mime_type ?? ''),
    fileSize: cleanNumber(row.file_size),
    documentType: String(row.document_type ?? 'other') as DocumentType,
    uploadStatus: String(row.upload_status ?? ''),
    processingStatus: String(row.processing_status ?? 'uploaded') as ProcessingStatus,
    linkedStatus: String(row.linked_status ?? 'unlinked') as 'linked' | 'unlinked',
    uploadedAt: String(row.uploaded_at ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    extraction: extractions[0] ? mapExtraction(extractions[0]) : undefined
  };
}

function fieldValue(extraction: unknown, path: string): string {
  const parts = path.split('.');
  let current: unknown = extraction;

  for (const part of parts) {
    current = (current as Record<string, unknown> | undefined)?.[part];
  }

  return String((current as { value?: unknown } | undefined)?.value ?? '');
}

function emptyReviewForm(document?: DocumentWithExtraction): ReviewForm {
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
    commencementDate: '',
    expiryDate: '',
    renewalReminder: '',
    renewalOption: '',
    noticePeriod: '',
    renewalHistory: '',
    specialClauses: '',
    notes: '',
    originalFilename: document?.originalFilename ?? ''
  };
}

function reviewFormFromDocument(document: DocumentWithExtraction): ReviewForm {
  const extraction = document.extraction?.extractedJson as TenancyExtraction | undefined;
  if (!extraction || typeof extraction !== 'object') return emptyReviewForm(document);

  return {
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
    monthlyRental: cleanNumber(fieldValue(extraction, 'financial.monthlyRental')),
    securityDeposit: cleanNumber(fieldValue(extraction, 'financial.securityDeposit')),
    utilityDeposit: cleanNumber(fieldValue(extraction, 'financial.utilityDeposit')),
    accessCardDeposit: cleanNumber(fieldValue(extraction, 'financial.accessCardDeposit')),
    carParkRemoteDeposit: cleanNumber(fieldValue(extraction, 'financial.carParkRemoteDeposit')),
    commencementDate: fieldValue(extraction, 'dates.commencementDate'),
    expiryDate: fieldValue(extraction, 'dates.expiryDate'),
    renewalReminder: fieldValue(extraction, 'dates.renewalReminder'),
    renewalOption: fieldValue(extraction, 'dates.renewalOption'),
    noticePeriod: fieldValue(extraction, 'dates.noticePeriod'),
    renewalHistory: fieldValue(extraction, 'clauses.renewalClause'),
    specialClauses: [
      fieldValue(extraction, 'clauses.specialClauses'),
      fieldValue(extraction, 'clauses.terminationClause'),
      fieldValue(extraction, 'clauses.diplomaticClause')
    ].filter(Boolean).join('\n\n'),
    notes: String(extraction.summary ?? ''),
    originalFilename: document.originalFilename
  };
}

function importPayload(form: ReviewForm) {
  return {
    tenant: form.tenant.trim(),
    tenantIdNo: form.tenantIdNo.trim(),
    tenantPhone: form.tenantPhone.trim(),
    tenantEmail: form.tenantEmail.trim(),
    landlord: form.landlord.trim(),
    landlordIdNo: form.landlordIdNo.trim(),
    landlordPhone: form.landlordPhone.trim(),
    landlordEmail: form.landlordEmail.trim(),
    property: form.property.trim(),
    unitNo: form.unitNo.trim(),
    propertyAddress: form.propertyAddress.trim(),
    propertyType: form.propertyType.trim(),
    monthlyRental: form.monthlyRental,
    securityDeposit: form.securityDeposit,
    utilityDeposit: form.utilityDeposit,
    accessCardDeposit: form.accessCardDeposit,
    carParkRemoteDeposit: form.carParkRemoteDeposit,
    commencementDateIso: displayDateToIso(form.commencementDate),
    expiryDateIso: displayDateToIso(form.expiryDate),
    renewalReminderIso: form.renewalReminder ? displayDateToIso(form.renewalReminder) : null,
    renewalOption: form.renewalOption.trim(),
    noticePeriod: form.noticePeriod.trim(),
    renewalHistory: form.renewalHistory.trim(),
    specialClauses: form.specialClauses.trim(),
    notes: form.notes.trim(),
    originalFilename: form.originalFilename
  };
}

function isMissingTableError(error: unknown): boolean {
  if (typeof error !== 'object' || !error) return false;
  const maybeError = error as { code?: string; message?: string };
  return maybeError.code === '42P01' || /relation .* does not exist/i.test(maybeError.message ?? '');
}

function readableApiError(error: string, language: Language) {
  const t = getDocumentTranslations(language);
  if (error === 'unsupported-file-type') return t.unsupportedFile;
  if (error === 'file-too-large') return t.fileTooLarge;
  if (error === 'possible-duplicate-tenancy') return t.linkedMatchNotice;
  if (error.includes('relation') || error.includes('does not exist') || error === 'tables-missing') return t.databaseMissing;
  if (error.includes('Supabase server configuration')) return t.databaseUnavailable;
  return error || t.uploadFailed;
}

function statusLabel(status: ProcessingStatus, language: Language) {
  const t = getDocumentTranslations(language);
  if (status === 'pending_review') return t.pending;
  if (status === 'extraction_completed') return t.completed;
  if (status === 'extraction_failed') return t.failed;
  if (status === 'ocr_required') return t.ocrRequired;
  if (status === 'imported') return t.imported;
  if (status === 'draft') return t.draft;
  if (status === 'extracting') return t.extracting;
  return t.uploaded;
}

function documentTypeLabel(type: DocumentType, language: Language) {
  const t = getDocumentTranslations(language);
  const labels: Record<DocumentType, string> = {
    tenancy_agreement: t.tenancyAgreement,
    tenancy_renewal: t.tenancyRenewal,
    letter_of_offer: t.letterOfOffer,
    booking_form: t.bookingForm,
    sale_purchase_agreement: t.salePurchaseAgreement,
    identity_document: t.identityDocument,
    company_document: t.companyDocument,
    utility_bill: t.utilityBill,
    inventory_list: t.inventoryList,
    other: t.other
  };

  return labels[type] ?? labels.other;
}

export default function DocumentsPage() {
  const [language, setLanguage] = useState<Language>(defaultLanguage);
  const t = getDocumentTranslations(language);
  const supabase = useMemo(getSupabaseClient, []);
  const [documents, setDocuments] = useState<DocumentWithExtraction[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [selectedId, setSelectedId] = useState('');
  const [reviewForm, setReviewForm] = useState<ReviewForm>(emptyReviewForm());
  const [operationId, setOperationId] = useState('');
  const [filters, setFilters] = useState<Filters>({
    query: '',
    documentType: 'all',
    processingStatus: 'all',
    linkedStatus: 'all',
    fromDate: '',
    toDate: ''
  });

  const selectedDocument = documents.find((document) => document.id === selectedId) ?? documents[0];

  useEffect(() => {
    const stored = window.localStorage.getItem(languageStorageKey) as Language | null;
    if (stored === 'en' || stored === 'zh') setLanguage(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(languageStorageKey, language);
  }, [language]);

  useEffect(() => {
    if (!supabase) {
      setNotice({ tone: 'warning', message: t.databaseUnavailable });
      setLoading(false);
      return;
    }

    let mounted = true;

    async function loadDocuments() {
      setLoading(true);
      const { data, error } = await supabase
        .from('documents')
        .select('*, document_extractions(*)')
        .order('uploaded_at', { ascending: false });

      if (!mounted) return;

      if (error) {
        setNotice({ tone: 'error', message: isMissingTableError(error) ? t.databaseMissing : error.message });
        setLoading(false);
        return;
      }

      const mapped = (data ?? []).map((row) => mapDocument(row as Record<string, unknown>));
      setDocuments(mapped);
      setSelectedId((current) => current || mapped[0]?.id || '');
      setLoading(false);
    }

    void loadDocuments();
    return () => {
      mounted = false;
    };
  }, [supabase, t.databaseMissing, t.databaseUnavailable]);

  useEffect(() => {
    if (selectedDocument) {
      const draftKey = `nexora-document-draft-${selectedDocument.id}`;
      const draft = window.localStorage.getItem(draftKey);
      setReviewForm(draft ? JSON.parse(draft) as ReviewForm : reviewFormFromDocument(selectedDocument));
    }
  }, [selectedDocument?.id]);

  const metrics = useMemo(() => {
    return {
      total: documents.length,
      pending: documents.filter((document) => document.processingStatus === 'pending_review').length,
      completed: documents.filter((document) => document.processingStatus === 'extraction_completed' || document.processingStatus === 'pending_review' || document.processingStatus === 'imported').length,
      failed: documents.filter((document) => document.processingStatus === 'extraction_failed' || document.processingStatus === 'ocr_required').length,
      linked: documents.filter((document) => document.linkedStatus === 'linked').length,
      unlinked: documents.filter((document) => document.linkedStatus === 'unlinked').length
    };
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    const fromIso = displayDateToIso(filters.fromDate) ?? '';
    const toIso = displayDateToIso(filters.toDate) ?? '';

    return documents.filter((document) => {
      const extraction = document.extraction?.extractedJson as TenancyExtraction | undefined;
      const haystack = [
        document.originalFilename,
        documentTypeLabel(document.documentType, language),
        fieldValue(extraction, 'property.propertyName'),
        fieldValue(extraction, 'landlord.name'),
        fieldValue(extraction, 'tenant.name')
      ].join(' ').toLowerCase();
      const uploadedDate = document.uploadedAt.slice(0, 10);

      if (query && !haystack.includes(query)) return false;
      if (filters.documentType !== 'all' && document.documentType !== filters.documentType) return false;
      if (filters.processingStatus !== 'all' && document.processingStatus !== filters.processingStatus) return false;
      if (filters.linkedStatus !== 'all' && document.linkedStatus !== filters.linkedStatus) return false;
      if (fromIso && uploadedDate < fromIso) return false;
      if (toIso && uploadedDate > toIso) return false;
      return true;
    });
  }, [documents, filters, language]);

  function addFiles(files: FileList | File[]) {
    const nextItems = Array.from(files).map((file): QueueItem => {
      const validation = validateDocumentFile(file);
      const duplicateWarning = queue.some((item) => item.file.name === file.name && item.file.size === file.size) ||
        documents.some((document) => document.originalFilename === file.name && document.fileSize === file.size);

      return {
        id: crypto.randomUUID(),
        file,
        status: validation.ok ? 'queued' : 'failed',
        progress: validation.ok ? 0 : 100,
        error: validation.ok ? '' : readableApiError(validation.error, language),
        documentType: 'tenancy_agreement',
        duplicateWarning
      };
    });

    setQueue((current) => [...nextItems, ...current]);
    if (nextItems.some((item) => item.duplicateWarning)) setNotice({ tone: 'warning', message: t.duplicateFile });
  }

  async function uploadQueueItem(itemId: string) {
    const item = queue.find((candidate) => candidate.id === itemId);
    if (!item || item.status === 'uploading') return;

    setOperationId(itemId);
    setQueue((current) => current.map((candidate) => candidate.id === itemId ? { ...candidate, status: 'uploading', progress: 20, error: '' } : candidate));

    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('documentType', item.documentType);

    try {
      setQueue((current) => current.map((candidate) => candidate.id === itemId ? { ...candidate, progress: 58 } : candidate));
      const response = await fetch('/api/documents/upload', { method: 'POST', body: formData });
      const payload = await response.json();

      if (!response.ok) throw new Error(readableApiError(String(payload.error ?? ''), language));

      const document = mapDocument({
        ...payload.document,
        document_extractions: payload.extraction ? [payload.extraction] : []
      });

      setDocuments((current) => [document, ...current.filter((existing) => existing.id !== document.id)]);
      setSelectedId(document.id);
      setQueue((current) => current.map((candidate) => candidate.id === itemId ? { ...candidate, status: 'completed', progress: 100, document, extraction: document.extraction } : candidate));
      setNotice({ tone: payload.ocrRequired ? 'warning' : 'success', message: payload.ocrRequired ? t.ocrNotConfigured : t.uploadComplete });
    } catch (error) {
      setQueue((current) => current.map((candidate) => candidate.id === itemId ? { ...candidate, status: 'failed', progress: 100, error: error instanceof Error ? error.message : t.uploadFailed } : candidate));
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : t.uploadFailed });
    } finally {
      setOperationId('');
    }
  }

  function cancelQueueItem(itemId: string) {
    setQueue((current) => current.map((item) => item.id === itemId && item.status === 'queued' ? { ...item, status: 'cancelled', progress: 100 } : item));
  }

  async function openSignedUrl(documentId: string, disposition: 'inline' | 'attachment') {
    setOperationId(`${disposition}-${documentId}`);

    try {
      const response = await fetch('/api/documents/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, disposition })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readableApiError(String(payload.error ?? ''), language));
      window.open(payload.signedUrl, '_blank', 'noopener,noreferrer');
      setNotice({ tone: 'info', message: t.secureLink });
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : t.signedUrlFailed });
    } finally {
      setOperationId('');
    }
  }

  function saveDraft() {
    if (!selectedDocument) return;
    window.localStorage.setItem(`nexora-document-draft-${selectedDocument.id}`, JSON.stringify(reviewForm));
    setNotice({ tone: 'success', message: t.draftSaved });
  }

  async function confirmImport() {
    if (!selectedDocument) return;

    const payload = importPayload(reviewForm);
    if (!payload.tenant || !payload.landlord || !payload.property || !payload.commencementDateIso || !payload.expiryDateIso) {
      setNotice({ tone: 'error', message: readableApiError('Missing required review fields.', language) });
      return;
    }

    setOperationId(`import-${selectedDocument.id}`);

    try {
      const response = await fetch('/api/documents/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: selectedDocument.id, reviewedJson: payload, importType: selectedDocument.documentType })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(readableApiError(String(result.error ?? ''), language));

      setDocuments((current) => current.map((document) => document.id === selectedDocument.id ? { ...document, linkedStatus: 'linked', processingStatus: 'imported' } : document));
      window.localStorage.removeItem(`nexora-document-draft-${selectedDocument.id}`);
      setNotice({ tone: 'success', message: t.importComplete });
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : t.importFailed });
    } finally {
      setOperationId('');
    }
  }

  return (
    <main className="command-shell">
      <header className="command-header">
        <div>
          <p className="eyebrow">NEXORA / Sprint 002</p>
          <h1>{t.title}</h1>
          <p className="header-copy">{t.subtitle}</p>
        </div>
        <div className="header-actions">
          <LanguageToggle language={language} onChange={setLanguage} />
          <nav className="top-nav" aria-label="Primary">
            <a className="ghost-button" href="/">{t.navRental}</a>
            <a className="ghost-button active" href="/documents">{t.navDocuments}</a>
            <a className="ghost-button" href="/collections">{language === 'zh' ? '智能收款中心' : 'Smart Collection Centre'}</a>
            <a className="ghost-button" href="/commercial">{language === 'zh' ? '商业 CRM' : 'Commercial CRM'}</a>
          </nav>
        </div>
      </header>

      {notice && <div className={`notice ${notice.tone}`}>{notice.message}</div>}

      <section className="metrics-grid document-metrics">
        <Metric label={t.totalDocuments} value={String(metrics.total)} />
        <Metric label={t.pendingReview} value={String(metrics.pending)} />
        <Metric label={t.extractionCompleted} value={String(metrics.completed)} tone="success" />
        <Metric label={t.extractionFailed} value={String(metrics.failed)} tone={metrics.failed ? 'danger' : undefined} />
        <Metric label={t.linkedToTenancy} value={String(metrics.linked)} />
        <Metric label={t.unlinkedDocuments} value={String(metrics.unlinked)} />
      </section>

      <section className="workspace-grid document-workspace">
        <div className="panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">{t.uploadDocuments}</p>
              <h2>{t.uploadQueue}</h2>
            </div>
          </div>

          <UploadZone t={t} onFiles={addFiles} />

          <div className="queue-stack">
            {queue.length === 0 ? (
              <EmptyState title={t.noDocuments} body={t.dropFiles} />
            ) : (
              queue.map((item) => (
                <article className="queue-item" key={item.id}>
                  <div>
                    <strong>{item.file.name}</strong>
                    <p>{Math.round(item.file.size / 1024)} KB / {item.file.type || 'unknown'}</p>
                    {item.duplicateWarning && <em>{t.duplicateFile}</em>}
                    {item.error && <em>{item.error}</em>}
                  </div>
                  <select value={item.documentType} onChange={(event) => {
                    const documentType = event.target.value as DocumentType;
                    setQueue((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, documentType } : candidate));
                  }} disabled={item.status === 'uploading' || item.status === 'completed'}>
                    {documentTypes.map((type) => <option value={type} key={type}>{documentTypeLabel(type, language)}</option>)}
                  </select>
                  <div className="progress-track"><span style={{ width: `${item.progress}%` }} /></div>
                  <div className="queue-actions">
                    {(item.status === 'queued' || item.status === 'failed') && <button className="secondary-button" onClick={() => uploadQueueItem(item.id)} disabled={operationId === item.id}>{item.status === 'failed' ? t.retry : t.stageUpload}</button>}
                    {item.status === 'queued' && <button className="ghost-button" onClick={() => cancelQueueItem(item.id)}>{t.cancel}</button>}
                    {item.status === 'completed' && <span className="status-pill paid">{t.completed}</span>}
                    {item.status === 'cancelled' && <span className="status-pill outstanding">{t.cancel}</span>}
                    {item.status === 'uploading' && <span className="status-pill partial">{t.extracting}</span>}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">{t.workflow}</p>
              <h2>{selectedDocument?.originalFilename ?? t.noDocuments}</h2>
            </div>
          </div>

          {!selectedDocument ? (
            <EmptyState title={loading ? t.loadingDocuments : t.noDocuments} body={t.noDocumentsBody} />
          ) : (
            <DocumentReview
              document={selectedDocument}
              form={reviewForm}
              language={language}
              operationId={operationId}
              onChange={setReviewForm}
              onDraft={saveDraft}
              onImport={confirmImport}
              onSignedUrl={openSignedUrl}
            />
          )}
        </div>
      </section>

      <section className="panel bottom-grid">
        <div className="section-title">
          <div>
            <p className="eyebrow">{t.recentlyUploaded}</p>
            <h2>{t.navDocuments}</h2>
          </div>
        </div>

        <FiltersPanel filters={filters} language={language} onChange={setFilters} />

        {filteredDocuments.length === 0 ? (
          <EmptyState title={t.noDocuments} body={t.noDocumentsBody} />
        ) : (
          <div className="document-table">
            {filteredDocuments.map((document) => {
              const extraction = document.extraction?.extractedJson as TenancyExtraction | undefined;
              return (
                <button className={`document-row ${selectedDocument?.id === document.id ? 'is-active' : ''}`} key={document.id} onClick={() => setSelectedId(document.id)}>
                  <span>
                    <strong>{document.originalFilename}</strong>
                    <small>{documentTypeLabel(document.documentType, language)}</small>
                  </span>
                  <span>{fieldValue(extraction, 'property.propertyName') || t.notDetected}</span>
                  <span>{fieldValue(extraction, 'tenant.name') || t.notDetected}</span>
                  <span>{isoToDisplayDate(document.uploadedAt.slice(0, 10))}</span>
                  <span className={`status-pill ${document.processingStatus === 'extraction_failed' || document.processingStatus === 'ocr_required' ? 'overdue' : 'paid'}`}>{statusLabel(document.processingStatus, language)}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function UploadZone({ t, onFiles }: { t: ReturnType<typeof getDocumentTranslations>; onFiles: (files: FileList | File[]) => void }) {
  return (
    <label className="upload-zone document-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault();
      onFiles(event.dataTransfer.files);
    }}>
      <span>{t.dropFiles}</span>
      <input type="file" multiple accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png" onChange={(event) => {
        if (event.target.files) onFiles(event.target.files);
        event.currentTarget.value = '';
      }} />
      <p>{t.browseFiles}</p>
    </label>
  );
}

function FiltersPanel({ filters, language, onChange }: { filters: Filters; language: Language; onChange: (filters: Filters) => void }) {
  const t = getDocumentTranslations(language);

  return (
    <div className="filters-grid">
      <label className="field">
        <span>{t.search}</span>
        <input value={filters.query} placeholder={`${t.filename} / ${t.property} / ${t.tenant}`} onChange={(event) => onChange({ ...filters, query: event.target.value })} />
      </label>
      <label className="field">
        <span>{t.documentType}</span>
        <select value={filters.documentType} onChange={(event) => onChange({ ...filters, documentType: event.target.value as Filters['documentType'] })}>
          <option value="all">{t.allTypes}</option>
          {documentTypes.map((type) => <option value={type} key={type}>{documentTypeLabel(type, language)}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t.extractionStatus}</span>
        <select value={filters.processingStatus} onChange={(event) => onChange({ ...filters, processingStatus: event.target.value as Filters['processingStatus'] })}>
          <option value="all">{t.allStatuses}</option>
          {processingStatuses.map((status) => <option value={status} key={status}>{statusLabel(status, language)}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t.linkedStatus}</span>
        <select value={filters.linkedStatus} onChange={(event) => onChange({ ...filters, linkedStatus: event.target.value as Filters['linkedStatus'] })}>
          <option value="all">{t.allLinks}</option>
          <option value="linked">{t.linked}</option>
          <option value="unlinked">{t.unlinked}</option>
        </select>
      </label>
      <label className="field">
        <span>{t.fromDate}</span>
        <input value={filters.fromDate} placeholder="DD/MM/YYYY" onChange={(event) => onChange({ ...filters, fromDate: event.target.value })} />
      </label>
      <label className="field">
        <span>{t.toDate}</span>
        <input value={filters.toDate} placeholder="DD/MM/YYYY" onChange={(event) => onChange({ ...filters, toDate: event.target.value })} />
      </label>
    </div>
  );
}

function DocumentReview({
  document,
  form,
  language,
  operationId,
  onChange,
  onDraft,
  onImport,
  onSignedUrl
}: {
  document: DocumentWithExtraction;
  form: ReviewForm;
  language: Language;
  operationId: string;
  onChange: (form: ReviewForm) => void;
  onDraft: () => void;
  onImport: () => void;
  onSignedUrl: (documentId: string, disposition: 'inline' | 'attachment') => void;
}) {
  const t = getDocumentTranslations(language);
  const extraction = document.extraction?.extractedJson as TenancyExtraction | undefined;
  const confidence = extraction?.document?.extractionConfidence ?? 'low';

  return (
    <div className="review-stack">
      <div className="workflow-steps">
        {[t.stageUpload, t.stageClassify, t.stageParse, t.stageExtract, t.stageReview, t.stageCorrect, t.stageSave, t.stageCompleted].map((step, index) => (
          <span className={index < 5 || document.processingStatus === 'imported' ? 'is-done' : ''} key={step}>{step}</span>
        ))}
      </div>

      <div className="document-meta-grid">
        <MemoryItem label={t.originalFilename} value={document.originalFilename} fallback={t.notDetected} />
        <MemoryItem label={t.documentType} value={documentTypeLabel(document.documentType, language)} fallback={t.notDetected} />
        <MemoryItem label={t.fileSize} value={`${Math.round(document.fileSize / 1024)} KB`} fallback={t.notDetected} />
        <MemoryItem label={t.uploadDate} value={isoToDisplayDate(document.uploadedAt.slice(0, 10))} fallback={t.notDetected} />
        <MemoryItem label={t.extractionStatus} value={statusLabel(document.processingStatus, language)} fallback={t.notDetected} />
        <MemoryItem label={t.extractionConfidence} value={confidence === 'high' ? t.high : confidence === 'medium' ? t.medium : t.low} fallback={t.notDetected} />
      </div>

      {document.processingStatus === 'ocr_required' && <div className="notice warning">{t.ocrNotConfigured}</div>}

      <div className="card-actions review-actions">
        <button className="ghost-button" onClick={() => onSignedUrl(document.id, 'inline')} disabled={operationId === `inline-${document.id}`}>{t.viewDocument}</button>
        <button className="ghost-button" onClick={() => onSignedUrl(document.id, 'attachment')} disabled={operationId === `attachment-${document.id}`}>{t.downloadDocument}</button>
      </div>

      <div>
        <p className="eyebrow">{t.reviewFields}</p>
        <div className="form-grid">
          <TextField label={t.tenant} value={form.tenant} onChange={(value) => onChange({ ...form, tenant: value })} required />
          <TextField label={t.landlord} value={form.landlord} onChange={(value) => onChange({ ...form, landlord: value })} required />
          <TextField label={t.property} value={form.property} onChange={(value) => onChange({ ...form, property: value })} required />
          <TextField label={t.unitNo} value={form.unitNo} onChange={(value) => onChange({ ...form, unitNo: value })} />
          <TextField label={t.propertyAddress} value={form.propertyAddress} onChange={(value) => onChange({ ...form, propertyAddress: value })} wide />
          <NumberField label={t.monthlyRental} value={form.monthlyRental} onChange={(value) => onChange({ ...form, monthlyRental: value })} />
          <NumberField label={t.securityDeposit} value={form.securityDeposit} onChange={(value) => onChange({ ...form, securityDeposit: value })} />
          <NumberField label={t.utilityDeposit} value={form.utilityDeposit} onChange={(value) => onChange({ ...form, utilityDeposit: value })} />
          <NumberField label={t.accessCardDeposit} value={form.accessCardDeposit} onChange={(value) => onChange({ ...form, accessCardDeposit: value })} />
          <NumberField label={t.carParkRemoteDeposit} value={form.carParkRemoteDeposit} onChange={(value) => onChange({ ...form, carParkRemoteDeposit: value })} />
          <TextField label={t.commencementDate} value={form.commencementDate} placeholder="DD/MM/YYYY" onChange={(value) => onChange({ ...form, commencementDate: value })} required />
          <TextField label={t.expiryDate} value={form.expiryDate} placeholder="DD/MM/YYYY" onChange={(value) => onChange({ ...form, expiryDate: value })} required />
          <TextField label={t.renewalReminder} value={form.renewalReminder} placeholder="DD/MM/YYYY" onChange={(value) => onChange({ ...form, renewalReminder: value })} />
          <TextField label={t.renewalOption} value={form.renewalOption} onChange={(value) => onChange({ ...form, renewalOption: value })} />
          <TextField label={t.noticePeriod} value={form.noticePeriod} onChange={(value) => onChange({ ...form, noticePeriod: value })} />
          <TextArea label={t.specialClauses} value={form.specialClauses} onChange={(value) => onChange({ ...form, specialClauses: value })} />
          <TextArea label={t.notes} value={form.notes} onChange={(value) => onChange({ ...form, notes: value })} />
        </div>
        <div className="card-actions review-actions">
          <button className="ghost-button" onClick={onDraft}>{t.saveDraft}</button>
          <button className="primary-button compact-primary" onClick={onImport} disabled={operationId === `import-${document.id}` || document.processingStatus === 'imported'}>
            {operationId === `import-${document.id}` ? t.stageSave : t.confirmImport}
          </button>
        </div>
      </div>

      <details className="raw-text">
        <summary>{t.sourceText}</summary>
        <pre>{document.extraction?.rawText || t.notDetected}</pre>
      </details>

      <MemoryItem label={t.aiSummary} value={document.extraction?.aiSummary ?? ''} fallback={t.notDetected} />
    </div>
  );
}

function LanguageToggle({ language, onChange }: { language: Language; onChange: (language: Language) => void }) {
  return (
    <div className="language-toggle" aria-label="Language">
      <button className={language === 'en' ? 'active' : ''} onClick={() => onChange('en')}>EN</button>
      <button className={language === 'zh' ? 'active' : ''} onClick={() => onChange('zh')}>中文</button>
    </div>
  );
}

function TextField({ label, value, onChange, wide = false, required = false, placeholder = '' }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; required?: boolean; placeholder?: string }) {
  return (
    <label className={wide ? 'wide field' : 'field'}>
      <span>{label}{required ? ' *' : ''}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min="0" value={value} placeholder="0" onChange={(event) => onChange(Number(event.target.value))} />
      <small>{formatMYR(value)}</small>
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="wide field">
      <span>{label}</span>
      <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
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
