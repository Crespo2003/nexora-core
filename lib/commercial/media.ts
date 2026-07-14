import { validateExtensionMatchesMime, validateFileSignature } from '../documents/upload';

export const commercialMediaBucket = 'commercial-media';
export const maxCommercialMediaBytes = 15 * 1024 * 1024;
export const commercialMediaTypes = ['property_photo','floor_plan','brochure','tenancy_document','authority_letter','site_plan','proposal_attachment'] as const;
export const commercialMediaMimeTypes = ['image/jpeg','image/png','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;

export function validateCommercialMedia(input: { buffer: Buffer; filename: string; mimeType: string; size: number; mediaType: string }) {
  if (!commercialMediaTypes.includes(input.mediaType as typeof commercialMediaTypes[number])) return 'invalid-media-category';
  if (!commercialMediaMimeTypes.includes(input.mimeType as typeof commercialMediaMimeTypes[number])) return 'unsupported-file-type';
  if (input.size <= 0 || input.size > maxCommercialMediaBytes) return 'file-too-large';
  if (!validateExtensionMatchesMime(input.filename, input.mimeType)) return 'file-extension-mismatch';
  if (!validateFileSignature(input.buffer, input.mimeType)) return 'file-content-mismatch';
  return null;
}

export function commercialMediaExtension(mimeType: string) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' } as Record<string, string>)[mimeType] ?? 'bin';
}
