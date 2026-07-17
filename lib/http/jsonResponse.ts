export type JsonApiPayload = Record<string, unknown>;

/**
 * Prevents a proxy, platform, or unexpected route failure from surfacing as a
 * JSON parse exception in the tenancy import UI. Route handlers are expected
 * to return JSON; callers receive a stable error code when that contract is
 * broken outside the application.
 */
export async function readJsonApiResponse(response: Response): Promise<JsonApiPayload> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) throw new Error('non-json-api-response');

  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid-json-api-response');
    return payload as JsonApiPayload;
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid-json-api-response') throw error;
    throw new Error('invalid-json-api-response');
  }
}
