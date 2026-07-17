import { classifyOpenAiError, createOpenAiClient } from '../ai/openAiClient';
import { getOpenAiApiKey, getOpenAiConfiguration } from '../ai/openAiConfig';
import { logOpenAiDiagnostic, logOpenAiError } from '../ai/extractionDiagnostics';
import type { OcrProvider, OcrResult } from './ocrProvider';
import { FallbackOcrProvider } from './fallbackOcr';

export class OpenAiOcrProvider implements OcrProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = getOpenAiConfiguration().ocrModel,
    private readonly fetcher?: typeof fetch
  ) {}

  async extractText(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<OcrResult> {
    const encoded = input.buffer.toString('base64');
    const media = input.mimeType.startsWith('image/')
      ? { type: 'input_image' as const, image_url: `data:${input.mimeType};base64,${encoded}`, detail: 'high' as const }
      : { type: 'input_file' as const, filename: input.filename, file_data: `data:${input.mimeType};base64,${encoded}` };
    const startedAt = Date.now();
    try {
      logOpenAiDiagnostic('ocr_started', { ocrModel: this.model, openAiKeyPresent: true });
      const client = createOpenAiClient({ apiKey: this.apiKey, fetcher: this.fetcher, timeoutMs: 90_000, maxRetries: 0 });
      const response = await client.responses.create({
        model: this.model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Transcribe all visible document text exactly and process every page. Preserve line breaks. For paginated files, begin each page with --- PAGE N --- using the physical page number. Return only the transcription.' },
            media
          ]
        }],
        max_output_tokens: 30_000
      });
      logOpenAiDiagnostic('ocr_response_received', { ocrModel: this.model, elapsedMs: Date.now() - startedAt });
      const text = String(response.output_text ?? '').trim();
      logOpenAiDiagnostic(text ? 'ocr_succeeded' : 'ocr_invalid_response', {
        ocrModel: this.model,
        textLength: text.length,
        elapsedMs: Date.now() - startedAt
      });
      return text ? { status: 'completed', text, error: '' } : { status: 'failed', text: '', error: 'ocr-malformed-or-empty-response' };
    } catch (error) {
      const classified = classifyOpenAiError(error);
      logOpenAiError('ocr_error', error, {
        ocrModel: this.model,
        fallbackReason: classified.code,
        statusCode: classified.status,
        requestId: classified.requestId,
        elapsedMs: Date.now() - startedAt
      });
      logOpenAiDiagnostic('ocr_failed', {
        ocrModel: this.model,
        fallbackReason: classified.code,
        statusCode: classified.status,
        requestId: classified.requestId,
        elapsedMs: Date.now() - startedAt
      });
      return { status: 'failed', text: '', error: classified.code === 'openai_timeout' ? 'ocr-provider-timeout' : 'ocr-provider-request-failed' };
    }
  }
}

export function createOcrProvider(): OcrProvider {
  const apiKey = getOpenAiApiKey();
  return apiKey ? new OpenAiOcrProvider(apiKey, getOpenAiConfiguration().ocrModel) : new FallbackOcrProvider();
}
