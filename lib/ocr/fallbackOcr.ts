import type { OcrProvider, OcrRequestContext, OcrResult } from './ocrProvider';

export class FallbackOcrProvider implements OcrProvider {
  readonly providerName = 'unconfigured';

  async extractText(_input: { buffer: Buffer; mimeType: string; filename: string }, _context?: OcrRequestContext): Promise<OcrResult> {
    return {
      status: 'not_configured',
      text: '',
      error: 'OCR provider is not configured.'
    };
  }
}
