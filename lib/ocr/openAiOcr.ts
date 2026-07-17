import type { OcrProvider, OcrResult } from './ocrProvider';
import { FallbackOcrProvider } from './fallbackOcr';

type ResponsesPayload = {
  output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  error?: { message?: string };
};

export class OpenAiOcrProvider implements OcrProvider {
  constructor(private readonly apiKey: string, private readonly model = process.env.OPENAI_OCR_MODEL || 'gpt-4.1-mini') {}

  async extractText(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<OcrResult> {
    const encoded = input.buffer.toString('base64');
    const media = input.mimeType.startsWith('image/')
      ? { type: 'input_image', image_url: `data:${input.mimeType};base64,${encoded}`, detail: 'high' }
      : { type: 'input_file', filename: input.filename, file_data: `data:${input.mimeType};base64,${encoded}`, detail: 'high' };
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: 'Transcribe all visible document text exactly and process every page. Preserve line breaks. For paginated files, begin each page with --- PAGE N --- using the physical page number. Return only the transcription.' },
              media
            ]
          }],
          max_output_tokens: 30_000
        }),
        signal: AbortSignal.timeout(180_000)
      });
      const payload = await response.json() as ResponsesPayload;
      if (!response.ok) return { status: 'failed', text: '', error: `ocr-provider-${response.status}` };
      const text = (payload.output ?? []).flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('\n').trim();
      return text ? { status: 'completed', text, error: '' } : { status: 'failed', text: '', error: 'ocr-malformed-or-empty-response' };
    } catch (error) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { status: 'failed', text: '', error: timeout ? 'ocr-provider-timeout' : 'ocr-provider-request-failed' };
    }
  }
}

export function createOcrProvider(): OcrProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAiOcrProvider(apiKey) : new FallbackOcrProvider();
}
