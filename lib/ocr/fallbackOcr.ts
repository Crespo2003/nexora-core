import type { OcrProvider, OcrResult } from './ocrProvider';

export class FallbackOcrProvider implements OcrProvider {
  async extractText(_input: { buffer: Buffer; mimeType: string; filename: string }): Promise<OcrResult> {
    return {
      status: 'not_configured',
      text: '',
      error: 'OCR provider is not configured.'
    };
  }
}
