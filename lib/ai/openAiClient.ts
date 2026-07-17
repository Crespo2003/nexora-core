import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';
import { getOpenAiApiKey, getOpenAiConfiguration } from './openAiConfig';

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
};

export class OpenAiClientError extends Error {
  constructor(public readonly code: 'openai_not_configured' | 'openai_timeout' | 'openai_request_failed' | 'invalid_ai_response', public readonly status?: number) {
    super(code);
    this.name = 'OpenAiClientError';
  }
}

export function createOpenAiClient(options: {
  apiKey?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
} = {}): OpenAI {
  assertServerRuntime();
  const apiKey = options.apiKey?.trim() || getOpenAiApiKey();
  if (!apiKey) throw new OpenAiClientError('openai_not_configured');
  return new OpenAI({
    apiKey,
    timeout: options.timeoutMs ?? 120_000,
    maxRetries: options.maxRetries ?? 2,
    fetch: options.fetcher as ConstructorParameters<typeof OpenAI>[0]['fetch'],
    dangerouslyAllowBrowser: false
  });
}

export async function requestStructuredOpenAi<T>(request: OpenAiStructuredRequest<T>): Promise<T> {
  const config = getOpenAiConfiguration();
  if (!request.apiKey && !config.configured) throw new OpenAiClientError('openai_not_configured');

  const attempts = Math.max(1, Math.min(request.maxAttempts ?? 3, 5));
  let lastError: OpenAiClientError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const client = createOpenAiClient({ apiKey: request.apiKey, fetcher: request.fetcher, timeoutMs: request.timeoutMs, maxRetries: 0 });
      const response = await client.responses.create({
        model: request.model ?? config.tenancyModel,
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
      });

      const payload = response as unknown as ResponsesPayload;
      const refusal = (payload.output ?? []).flatMap((item) => item.content ?? []).find((item) => item.refusal)?.refusal;
      if (refusal) throw new OpenAiClientError('invalid_ai_response');
      const outputText = payload.output_text ?? (payload.output ?? [])
        .flatMap((item) => item.content ?? [])
        .filter((item) => item.type === 'output_text' || Boolean(item.text))
        .map((item) => item.text ?? '')
        .join('')
        .trim();
      if (!outputText) throw new OpenAiClientError('invalid_ai_response');
      try {
        return request.validate(JSON.parse(outputText));
      } catch {
        throw new OpenAiClientError('invalid_ai_response');
      }
    } catch (error) {
      const normalized = classifyOpenAiError(error);
      if (!isRetryableError(normalized) || attempt === attempts) throw normalized;
      lastError = normalized;
    }

    await delay(retryDelay(attempt));
  }

  throw lastError ?? new OpenAiClientError('openai_request_failed');
}

export function classifyOpenAiError(error: unknown): OpenAiClientError {
  if (error instanceof OpenAiClientError) return error;
  if (error instanceof APIConnectionTimeoutError) return new OpenAiClientError('openai_timeout');
  if (error instanceof APIConnectionError) {
    const cause = error.cause;
    return cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')
      ? new OpenAiClientError('openai_timeout')
      : new OpenAiClientError('openai_request_failed');
  }
  if (error instanceof APIError) {
    return error.status === 401
      ? new OpenAiClientError('openai_not_configured', error.status)
      : new OpenAiClientError('openai_request_failed', error.status);
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new OpenAiClientError('openai_timeout');
  }
  if (error instanceof TypeError) return new OpenAiClientError('invalid_ai_response');
  return new OpenAiClientError('openai_request_failed');
}

function isRetryableError(error: OpenAiClientError): boolean {
  if (error.code === 'openai_timeout' || error.code === 'invalid_ai_response') return true;
  if (error.code !== 'openai_request_failed') return false;
  return error.status === undefined || error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
}

function retryDelay(attempt: number): number {
  return Math.min(4_000, 300 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 100);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertServerRuntime(): void {
  if (typeof window !== 'undefined') throw new Error('The OpenAI client is server-only.');
}
