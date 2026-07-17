export type JsonApiPayload = Record<string, unknown>;

export type JsonApiFailureDetails = {
  status: number;
  contentType: string;
  bodyPrefix: string;
  requestId: string;
  redirected: boolean;
  url: string;
};

export class JsonApiResponseError extends Error {
  constructor(
    public readonly code: 'non-json-api-response' | 'invalid-json-api-response',
    public readonly details: JsonApiFailureDetails
  ) {
    super(code);
    this.name = 'JsonApiResponseError';
  }
}

/**
 * Reads a response exactly once. Platform HTML, redirects, and malformed JSON
 * become a typed client error rather than a browser JSON parsing exception.
 */
export async function readJsonApiResponse(response: Response): Promise<JsonApiPayload> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const body = await response.text();
  const details: JsonApiFailureDetails = {
    status: response.status,
    contentType,
    bodyPrefix: safeBodyPrefix(body),
    requestId: response.headers.get('x-request-id') ?? response.headers.get('x-vercel-id') ?? '',
    redirected: response.redirected,
    url: response.url
  };

  if (!contentType.includes('application/json')) {
    throw new JsonApiResponseError('non-json-api-response', details);
  }

  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload-not-an-object');
    return payload as JsonApiPayload;
  } catch {
    throw new JsonApiResponseError('invalid-json-api-response', details);
  }
}

function safeBodyPrefix(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/\+?\d[\d ()-]{7,}\d/g, '[redacted-number]')
    .replace(/\b\d{6,}\b/g, '[redacted-number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
