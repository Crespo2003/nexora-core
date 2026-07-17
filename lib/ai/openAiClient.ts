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
    public readonly requestId?: string,
    message: string = code
  ) {
    super(message);
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
    try {
      logOpenAiDiagnostic('request_started', { attempt, tenancyModel: model, openAiKeyPresent: true });
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

      const payload = response as unknown as ResponsesPayload;
      const refusal = (payload.output ?? []).flatMap((item) => item.content ?? []).find((item) => item.refusal)?.refusal;
      const requestId = readResponseRequestId(response);
      const responseStatus = readResponseStatus(response);
      if (refusal) {
        logOpenAiDiagnostic('response_received', {
          attempt,
          tenancyModel: model,
          statusCode: 200,
          responseStatus,
          requestId,
          rawOpenAiResponsePreview: previewForLogs(refusal)
        });
        throw new OpenAiClientError('invalid_ai_response', undefined, requestId, 'OpenAI refused the extraction request.');
      }
      const outputText = payload.output_text ?? (payload.output ?? [])
        .flatMap((item) => item.content ?? [])
        .filter((item) => item.type === 'output_text' || Boolean(item.text))
        .map((item) => item.text ?? '')
        .join('')
        .trim();

      logOpenAiDiagnostic('response_received', {
        attempt,
        tenancyModel: model,
        statusCode: 200,
        responseStatus,
        requestId,
        rawOpenAiResponsePreview: previewForLogs(outputText)
      });

      if (!outputText) {
        throw new OpenAiClientError('invalid_ai_response', undefined, requestId, 'OpenAI returned an empty extraction response.');
      }

      let parsed: unknown;
      try {
        parsed = parseOpenAiJsonObject(outputText);
        logOpenAiDiagnostic('json_parse_completed', {
          attempt,
          tenancyModel: model,
          requestId,
          jsonParseResult: 'succeeded'
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'OpenAI response could not be parsed as JSON.';
        logOpenAiDiagnostic('json_parse_completed', {
          attempt,
          tenancyModel: model,
          requestId,
          jsonParseResult: 'failed',
          errorMessage: previewForLogs(message)
        });
        throw new OpenAiClientError('invalid_ai_response', undefined, requestId, `OpenAI response JSON parsing failed: ${message}`);
      }

      try {
        const result = request.validate(parsed);
        logOpenAiDiagnostic('request_succeeded', {
          attempt,
          tenancyModel: model,
          statusCode: 200,
          responseStatus,
          requestId,
          ...usageDiagnostics(payload)
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'OpenAI JSON did not satisfy the extraction schema.';
        logOpenAiDiagnostic('schema_validation_failed', {
          attempt,
          tenancyModel: model,
          requestId,
          jsonParseResult: 'succeeded',
          errorMessage: previewForLogs(message)
        });
        throw new OpenAiClientError('invalid_ai_response', undefined, requestId, `OpenAI response schema validation failed: ${message}`);
      }
    } catch (error) {
      const normalized = classifyOpenAiError(error);
      logOpenAiError('request_error', error, {
        attempt,
        tenancyModel: model,
        fallbackReason: normalized.code,
        statusCode: normalized.status,
        requestId: normalized.requestId
      });
      logOpenAiDiagnostic('request_failed', {
        attempt,
        tenancyModel: model,
        fallbackReason: normalized.code,
        statusCode: normalized.status,
        requestId: normalized.requestId
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
  if (error instanceof APIConnectionTimeoutError) return new OpenAiClientError('openai_timeout', undefined, undefined, error.message);
  if (error instanceof APIConnectionError) {
    const cause = error.cause;
    return cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')
      ? new OpenAiClientError('openai_timeout', undefined, undefined, cause.message)
      : new OpenAiClientError('openai_request_failed', undefined, undefined, error.message);
  }
  if (error instanceof APIError) {
    const requestId = readApiErrorRequestId(error);
    if (error.status === 401) return new OpenAiClientError('openai_authentication_failed', error.status, requestId, error.message);
    if (error.status === 403) return new OpenAiClientError('openai_permission_denied', error.status, requestId, error.message);
    if (error.status === 404) return new OpenAiClientError('openai_model_not_found', error.status, requestId, error.message);
    if (error.status === 429) return new OpenAiClientError('openai_rate_limited', error.status, requestId, error.message);
    if (error.status === 400 || error.status === 422) return new OpenAiClientError('openai_bad_request', error.status, requestId, error.message);
    if (error.status >= 500) return new OpenAiClientError('openai_server_error', error.status, requestId, error.message);
    return new OpenAiClientError('openai_request_failed', error.status, requestId, error.message);
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new OpenAiClientError('openai_timeout', undefined, undefined, error.message);
  }
  if (error instanceof TypeError) return new OpenAiClientError('invalid_ai_response', undefined, undefined, error.message);
  return new OpenAiClientError(
    'openai_request_failed',
    undefined,
    undefined,
    error instanceof Error ? error.message : 'OpenAI request failed for an unknown reason.'
  );
}

/**
 * Structured Outputs should be JSON already. This parser also accepts a JSON
 * object surrounded by markdown or a short explanation so one malformed model
 * presentation never drops an otherwise valid tenancy extraction.
 */
export function parseOpenAiJsonObject(output: string): Record<string, unknown> {
  const trimmed = output.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? trimmed;
  const candidates = [fenced, extractFirstJsonObject(fenced)].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try the next candidate. The final error below includes a useful reason.
    }
  }

  throw new Error('No valid JSON object was found in the OpenAI response.');
}

function extractFirstJsonObject(value: string): string {
  const start = value.indexOf('{');
  if (start < 0) return '';

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaping) escaping = false;
      else if (character === '\\') escaping = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return '';
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

function readResponseStatus(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const status = (response as { status?: unknown }).status;
  return typeof status === 'string' ? status : undefined;
}

function previewForLogs(value: string): string {
  return value.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
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
