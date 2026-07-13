import { allowedDocumentMimeTypes, maxDocumentUploadBytes } from './types';

export function sanitizeFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? 'document';
  const base = filename
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  return `${base || 'real-estate-document'}-${crypto.randomUUID()}.${extension}`;
}

export function validateDocumentFile(file: File) {
  const mimeType = file.type || inferMimeTypeFromName(file.name);

  if (!allowedDocumentMimeTypes.includes(mimeType)) {
    return { ok: false, error: 'unsupported-file-type' };
  }

  if (file.size > maxDocumentUploadBytes) {
    return { ok: false, error: 'file-too-large' };
  }

  return { ok: true, error: '' };
}

export function inferMimeTypeFromName(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

export function uniqueStoragePath(filename: string, bucketFolder = 'document-centre') {
  const year = new Date().getFullYear();
  return `${bucketFolder}/${year}/${sanitizeFilename(filename)}`;
}
