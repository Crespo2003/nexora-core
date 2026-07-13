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

export function validateFileSignature(buffer: Buffer, mimeType: string) {
  if (buffer.length < 4) return false;

  if (mimeType === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  }

  return false;
}

export function workspaceStoragePath(workspaceId: string, documentType: string, filename: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const folder = documentType
    .normalize('NFKD')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${workspaceId}/${folder || 'documents'}/${year}/${month}/${sanitizeFilename(filename)}`;
}
