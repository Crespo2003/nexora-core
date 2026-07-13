export function detectScannedDocument(rawText: string, mimeType: string) {
  const text = rawText.trim();
  const isImage = mimeType.startsWith('image/');

  return {
    ocrRequired: isImage || text.length < 80,
    readableText: text.length >= 80,
    reason: isImage ? 'image-file' : text.length < 80 ? 'insufficient-text' : 'text-readable'
  };
}
