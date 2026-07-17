import { classifyOpenAiError, createOpenAiClient } from '../ai/openAiClient';
import { getOpenAiApiKey, getOpenAiConfiguration } from '../ai/openAiConfig';
import { logOpenAiDiagnostic, logOpenAiError } from '../ai/extractionDiagnostics';
import type { OcrProvider, OcrRequestContext, OcrResult } from './ocrProvider';
import { FallbackOcrProvider } from './fallbackOcr';

const ocrRequestTimeoutMs = 120_000;
const ocrMaxAttempts = 2;

export class OpenAiOcrProvider implements OcrProvider {
  readonly providerName = 'openai-responses-file';

  constructor(
    private readonly apiKey: string,
    private readonly model = getOpenAiConfiguration().ocrModel,
    private readonly fetcher?: typeof fetch
  ) {}

  async extractText(input: { buffer: Buffer; mimeType: string; filename: string }, context: OcrRequestContext = {}): Promise<OcrResult> {
    const encoded = input.buffer.toString('base64');
    const media = input.mimeType.startsWith('image/')
      ? { type: 'input_image' as const, image_url: `data:${input.mimeType};base64,${encoded}`, detail: 'high' as const }
      : { type: 'input_file' as const, filename: input.filename, file_data: `data:${input.mimeType};base64,${encoded}` };
    const diagnosticContext = {
      requestId: context.requestId,
      pageNumber: context.pageNumber,
      pageCount: context.pageCount,
      ocrProvider: this.providerName,
      ocrModel: this.model
    };
    let lastError = 'ocr-provider-request-failed';

    for (let attempt = 1; attempt <= ocrMaxAttempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        logOpenAiDiagnostic('ocr_started', { ...diagnosticContext, attempt, openAiKeyPresent: true });
        logOpenAiDiagnostic('ocr_request_payload', {
          ...diagnosticContext,
          attempt,
          payloadType: input.mimeType,
          payloadBytes: input.buffer.byteLength,
          inputKind: media.type
        });
        const client = createOpenAiClient({ apiKey: this.apiKey, fetcher: this.fetcher, timeoutMs: ocrRequestTimeoutMs, maxRetries: 0 });
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
        logOpenAiDiagnostic('ocr_response_received', {
          ...diagnosticContext,
          attempt,
          responseStatus: String(response.status ?? 'completed'),
          elapsedMs: Date.now() - startedAt
        });
        const text = String(response.output_text ?? '').trim();
        logOpenAiDiagnostic(text ? 'ocr_succeeded' : 'ocr_invalid_response', {
          ...diagnosticContext,
          attempt,
          textLength: text.length,
          elapsedMs: Date.now() - startedAt
        });
        if (text) return { status: 'completed', text, error: '' };
        lastError = 'ocr-malformed-or-empty-response';
      } catch (error) {
        const classified = classifyOpenAiError(error);
        lastError = classified.code === 'openai_timeout' ? 'ocr-provider-timeout' : 'ocr-provider-request-failed';
        logOpenAiError('ocr_error', error, {
          ...diagnosticContext,
          attempt,
          fallbackReason: classified.code,
          statusCode: classified.status,
          upstreamRequestId: classified.requestId,
          elapsedMs: Date.now() - startedAt
        });
        logOpenAiDiagnostic('ocr_failed', {
          ...diagnosticContext,
          attempt,
          fallbackReason: classified.code,
          statusCode: classified.status,
          upstreamRequestId: classified.requestId,
          elapsedMs: Date.now() - startedAt
        });
        if (!isRetryableOcrFailure(classified.code)) break;
      }

      if (attempt < ocrMaxAttempts) {
        logOpenAiDiagnostic('ocr_retry_scheduled', { ...diagnosticContext, attempt, fallbackReason: lastError });
        await delayForRetry(attempt);
      }
    }

    return { status: 'failed', text: '', error: lastError };
  }
}

function isRetryableOcrFailure(code: string): boolean {
  return code === 'openai_timeout'
    || code === 'openai_request_failed'
    || code === 'openai_server_error'
    || code === 'openai_rate_limited'
    || code === 'invalid_ai_response';
}

function delayForRetry(attempt: number): Promise<void> {
  const milliseconds = 300 * attempt;
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createOcrProvider(): OcrProvider {
  const apiKey = getOpenAiApiKey();
  return apiKey ? new OpenAiOcrProvider(apiKey, getOpenAiConfiguration().ocrModel) : new FallbackOcrProvider();
}
