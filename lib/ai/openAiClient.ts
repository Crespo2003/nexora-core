export type OpenAiStructuredRequest<T> = {
  apiKey?: string;
  model?: string;
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  prompt: string;
  fetcher?: typeof fetch;
  maxOutputTokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  validate: (value: unknown) => T;
};

type ResponsesPayload = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string; type?: string; refusal?: string }> }>;
  error?: { message?: string };
};

export class OpenAiClientError extends Error {
  constructor(public readonly code: string, public readonly status?: number) {
    super(code);
    this.name = 'OpenAiClientError';
  }
}

export async function requestStructuredOpenAi<T>(request: OpenAiStructuredRequest<T>): Promise<T> {
  const apiKey = request.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAiClientError('openai-not-configured');

  const fetcher = request.fetcher ?? fetch;
  const attempts = Math.max(1, Math.min(request.maxAttempts ?? 3, 5));
  let lastError: OpenAiClientError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model ?? process.env.OPENAI_TENANCY_MODEL ?? 'gpt-5.5',
          store: false,
          input: [
            { role: 'system', content: [{ type: 'input_text', text: request.system }] },
            { role: 'user', content: [{ type: 'input_text', text: request.prompt }] }
          ],
          text: {
            format: {
              type: 'json_schema',
              name: request.schemaName,
              strict: true,
              schema: request.schema
            }
          },
          max_output_tokens: request.maxOutputTokens ?? 12_000
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? 120_000)
      });

      const payload = await readPayload(response);
      if (!response.ok) {
        const error = new OpenAiClientError(`openai-response-${response.status}`, response.status);
        if (!isRetryableStatus(response.status) || attempt === attempts) throw error;
        lastError = error;
      } else {
        const refusal = (payload.output ?? []).flatMap((item) => item.content ?? []).find((item) => item.refusal)?.refusal;
        if (refusal) throw new OpenAiClientError('openai-refused-extraction', response.status);
        const outputText = payload.output_text ?? (payload.output ?? [])
          .flatMap((item) => item.content ?? [])
          .filter((item) => item.type === 'output_text' || Boolean(item.text))
          .map((item) => item.text ?? '')
          .join('')
          .trim();
        if (!outputText) throw new OpenAiClientError('openai-empty-extraction', response.status);
        try {
          return request.validate(JSON.parse(outputText));
        } catch {
          throw new OpenAiClientError('openai-invalid-extraction', response.status);
        }
      }
    } catch (error) {
      const normalized = normalizeError(error);
      if (!isRetryableError(normalized) || attempt === attempts) throw normalized;
      lastError = normalized;
    }

    await delay(retryDelay(attempt));
  }

  throw lastError ?? new OpenAiClientError('openai-request-failed');
}

async function readPayload(response: Response): Promise<ResponsesPayload> {
  try {
    return await response.json() as ResponsesPayload;
  } catch {
    return {};
  }
}

function normalizeError(error: unknown): OpenAiClientError {
  if (error instanceof OpenAiClientError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new OpenAiClientError('openai-timeout');
  }
  return new OpenAiClientError('openai-request-failed');
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableError(error: OpenAiClientError): boolean {
  return error.code === 'openai-timeout' || error.code === 'openai-request-failed'
    || (typeof error.status === 'number' && isRetryableStatus(error.status));
}

function retryDelay(attempt: number): number {
  return Math.min(4_000, 300 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 100);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
