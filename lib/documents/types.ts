export type DocumentType =
  | 'tenancy_agreement'
  | 'tenancy_renewal'
  | 'letter_of_offer'
  | 'booking_form'
  | 'sale_purchase_agreement'
  | 'identity_document'
  | 'company_document'
  | 'utility_bill'
  | 'inventory_list'
  | 'other';

export type ProcessingStatus =
  | 'uploaded'
  | 'pending_review'
  | 'extracting'
  | 'extraction_completed'
  | 'extraction_failed'
  | 'ocr_required'
  | 'imported'
  | 'draft';

export type DocumentRecord = {
  id: string;
  originalFilename: string;
  sanitizedFilename: string;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  documentType: DocumentType;
  uploadStatus: string;
  processingStatus: ProcessingStatus;
  linkedStatus: 'linked' | 'unlinked';
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentExtractionRecord = {
  id: string;
  documentId: string;
  extractionVersion: string;
  rawText: string;
  extractedJson: unknown;
  confidenceJson: unknown;
  aiSummary: string;
  extractionStatus: ProcessingStatus;
  extractionError: string;
  startedAt: string;
  completedAt: string;
};

export type UploadQueueItem = {
  id: string;
  file: File;
  status: 'queued' | 'uploading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error: string;
  document?: DocumentRecord;
  extraction?: DocumentExtractionRecord;
};

export const documentTypes: DocumentType[] = [
  'tenancy_agreement',
  'tenancy_renewal',
  'letter_of_offer',
  'booking_form',
  'sale_purchase_agreement',
  'identity_document',
  'company_document',
  'utility_bill',
  'inventory_list',
  'other'
];

export const allowedDocumentMimeTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png'
];

export const maxDocumentUploadBytes = 10 * 1024 * 1024;
export const maxDocumentPageCount = 100;
