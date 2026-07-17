import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';
import { getOpenAiApiKey, getOpenAiConfiguration } from './openAiConfig';
import { logOpenAiDiagnostic, logOpenAiError } from './extractionDiagnostics';

export type OpenAiFailureCode =
  | 'openai_not_configured'
  | 'openai_authentication_failed'
  | 'openai_permission_denied'
  | 'openai_model_not_found'
  | 'openai_rate_limited'
  | 'openai_bad_request'
  | 'openai_server_error'
  | 'openai_timeout'
  | 'openai_request_failed'
  | 'invalid_ai_response';

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
  requestId?: string;
  validate: (value: unknown) => T;
};

type ResponsesPayload = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string; type?: string; refusal?: string }> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export class OpenAiClientError extends Error {
  constructor(
    public readonly code: OpenAiFailureCode,
    public readonly status?: number,
    public readonly requestId?: string
  ) {
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
  const model = request.model ?? config.tenancyModel;
  let lastError: OpenAiClientError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const attemptStartedAt = Date.now();
    try {
      logOpenAiDiagnostic('request_started', { requestId: request.requestId, attempt, tenancyModel: model, openAiKeyPresent: true });
      const client = createOpenAiClient({ apiKey: request.apiKey, fetcher: request.fetcher, timeoutMs: request.timeoutMs, maxRetries: 0 });
      const response = await client.responses.create({
        model,
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

      logOpenAiDiagnostic('response_received', {
        requestId: request.requestId,
        attempt,
        tenancyModel: model,
        upstreamRequestId: readResponseRequestId(response),
        elapsedMs: Date.now() - attemptStartedAt
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
      const parsingStartedAt = Date.now();
      try {
        const result = request.validate(JSON.parse(outputText));
        logOpenAiDiagnostic('response_parsed', {
          requestId: request.requestId,
          attempt,
          tenancyModel: model,
          upstreamRequestId: readResponseRequestId(response),
          elapsedMs: Date.now() - parsingStartedAt
        });
        logOpenAiDiagnostic('request_succeeded', {
          requestId: request.requestId,
          attempt,
          tenancyModel: model,
          upstreamRequestId: readResponseRequestId(response),
          elapsedMs: Date.now() - attemptStartedAt,
          ...usageDiagnostics(payload)
        });
        return result;
      } catch {
        logOpenAiDiagnostic('response_parse_failed', {
          requestId: request.requestId,
          attempt,
          tenancyModel: model,
          upstreamRequestId: readResponseRequestId(response),
          elapsedMs: Date.now() - parsingStartedAt
        });
        throw new OpenAiClientError('invalid_ai_response');
      }
    } catch (error) {
      const normalized = classifyOpenAiError(error);
      logOpenAiError('request_error', error, {
        requestId: request.requestId,
        attempt,
        tenancyModel: model,
        fallbackReason: normalized.code,
        statusCode: normalized.status,
        upstreamRequestId: normalized.requestId,
        elapsedMs: Date.now() - attemptStartedAt
      });
      logOpenAiDiagnostic('request_failed', {
        requestId: request.requestId,
        attempt,
        tenancyModel: model,
        fallbackReason: normalized.code,
        statusCode: normalized.status,
        upstreamRequestId: normalized.requestId,
        elapsedMs: Date.now() - attemptStartedAt
      });
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
    const requestId = readApiErrorRequestId(error);
    if (error.status === 401) return new OpenAiClientError('openai_authentication_failed', error.status, requestId);
    if (error.status === 403) return new OpenAiClientError('openai_permission_denied', error.status, requestId);
    if (error.status === 404) return new OpenAiClientError('openai_model_not_found', error.status, requestId);
    if (error.status === 429) return new OpenAiClientError('openai_rate_limited', error.status, requestId);
    if (error.status === 400 || error.status === 422) return new OpenAiClientError('openai_bad_request', error.status, requestId);
    if (error.status >= 500) return new OpenAiClientError('openai_server_error', error.status, requestId);
    return new OpenAiClientError('openai_request_failed', error.status, requestId);
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new OpenAiClientError('openai_timeout');
  }
  if (error instanceof TypeError) return new OpenAiClientError('invalid_ai_response');
  return new OpenAiClientError('openai_request_failed');
}

function isRetryableError(error: OpenAiClientError): boolean {
  if (error.code === 'openai_timeout' || error.code === 'invalid_ai_response') return true;
  if (error.code === 'openai_rate_limited' || error.code === 'openai_server_error') return true;
  if (error.code !== 'openai_request_failed') return false;
  return error.status === undefined || error.status === 408 || error.status === 409;
}

function readApiErrorRequestId(error: APIError): string | undefined {
  const candidate = error as APIError & { request_id?: string; requestID?: string };
  return candidate.request_id ?? candidate.requestID;
}

function readResponseRequestId(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const candidate = response as { _request_id?: string; request_id?: string };
  return candidate._request_id ?? candidate.request_id;
}

function usageDiagnostics(payload: ResponsesPayload): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedRequestCostUsd?: number;
} {
  const inputTokens = finiteNonNegative(payload.usage?.input_tokens);
  const outputTokens = finiteNonNegative(payload.usage?.output_tokens);
  const totalTokens = finiteNonNegative(payload.usage?.total_tokens);
  const inputRate = finiteNonNegative(Number(process.env.OPENAI_INPUT_COST_PER_MILLION_USD));
  const outputRate = finiteNonNegative(Number(process.env.OPENAI_OUTPUT_COST_PER_MILLION_USD));
  const estimatedRequestCostUsd = inputRate !== undefined && outputRate !== undefined && inputTokens !== undefined && outputTokens !== undefined
    ? Number((((inputTokens * inputRate) + (outputTokens * outputRate)) / 1_000_000).toFixed(8))
    : undefined;
  return { inputTokens, outputTokens, totalTokens, estimatedRequestCostUsd };
}

function finiteNonNegative(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
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
