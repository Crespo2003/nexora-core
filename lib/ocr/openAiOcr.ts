import { classifyOpenAiError, createOpenAiClient } from '../ai/openAiClient';
import { getOpenAiApiKey, getOpenAiConfiguration } from '../ai/openAiConfig';
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
    try {
      const client = createOpenAiClient({ apiKey: this.apiKey, fetcher: this.fetcher, timeoutMs: 180_000, maxRetries: 2 });
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
      const text = String(response.output_text ?? '').trim();
      return text ? { status: 'completed', text, error: '' } : { status: 'failed', text: '', error: 'ocr-malformed-or-empty-response' };
    } catch (error) {
      const classified = classifyOpenAiError(error);
      return { status: 'failed', text: '', error: classified.code === 'openai_timeout' ? 'ocr-provider-timeout' : 'ocr-provider-request-failed' };
    }
  }
}

export function createOcrProvider(): OcrProvider {
  const apiKey = getOpenAiApiKey();
  return apiKey ? new OpenAiOcrProvider(apiKey, getOpenAiConfiguration().ocrModel) : new FallbackOcrProvider();
}
