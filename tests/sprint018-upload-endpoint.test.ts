import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createTenancyUploadHandler } from '../lib/tenancy/tenancyUploadHandler';
import { attachLegalIntelligence, type TenancyLegalIntelligence } from '../lib/ai/extractTenancy';
import { JsonApiResponseError, readJsonApiResponse } from '../lib/http/jsonResponse';
import { mapTenancyExtractionToForm } from '../lib/tenancy/mapTenancyExtractionToForm';

const knownAgreementText = 'MALAYSIAN TENANCY AGREEMENT\nTenant: Test Tenant\nLandlord: Test Landlord\nMonthly rental: RM 3500\nSecurity deposit: RM 7000\nCommencement date: 2026-07-01\nExpiry date: 2028-06-30\nTermination: Two months notice.\nInspection: 24 hours notice.\nWitness: Test Witness.\nStamp duty: RM 350.';

test('successful multipart upload returns a JSON response and reaches form mapping', async () => {
  const response = await upload(new File([knownAgreementText], 'known-agreement.txt', { type: 'text/plain' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  const payload = await response.json() as Record<string, any>;
  assert.equal(payload.success, true);
  assert.ok(payload.requestId);
  assert.equal(mapTenancyExtractionToForm(payload.extraction, { workspaceId: 'workspace-test' }).monthlyRental, 3500);
});

test('unsupported files, oversized uploads, and auth failures always return the upload JSON contract', async () => {
  const unsupported = await upload(new File(['binary'], 'agreement.exe', { type: 'application/octet-stream' }));
  await assertUploadFailure(unsupported, 400, 'validation', 'unsupported-file-type');

  const oversized = await upload(new File([new Uint8Array((10 * 1024 * 1024) + 1)], 'agreement.txt', { type: 'text/plain' }));
  await assertUploadFailure(oversized, 413, 'validation', 'file-too-large');

  const handler = createTenancyUploadHandler({
    requireWorkspaceAccess: async () => Response.json({ success: false, error: 'authentication-required' }, { status: 401 })
  });
  const body = new FormData();
  body.append('file', new File([knownAgreementText], 'agreement.txt', { type: 'text/plain' }));
  await assertUploadFailure(await handler(new Request('https://nexora.test/api/tenancy-import/upload', { method: 'POST', body })), 401, 'auth', 'authentication-required');
});

test('PDF and OpenAI exceptions are converted to JSON rather than platform responses', async () => {
  const pdf = new File(['%PDF-1.7\nsynthetic'], 'known-agreement.pdf', { type: 'application/pdf' });
  const pdfHandler = createHandler(async () => {
    const error = new Error('text extraction failed') as Error & { code: string };
    error.code = 'text_extraction_failed';
    throw error;
  });
  await assertUploadFailure(await post(pdfHandler, pdf), 422, 'pdf', 'text_extraction_failed');

  const aiHandler = createHandler(async () => {
    const error = new Error('OpenAI timed out') as Error & { code: string };
    error.code = 'openai_timeout';
    throw error;
  });
  await assertUploadFailure(await post(aiHandler, new File([knownAgreementText], 'known-agreement.txt', { type: 'text/plain' })), 422, 'openai', 'openai_timeout');
});

test('legal analysis failure retains the successful base tenancy extraction', () => {
  const base = legalExtraction();
  const result = attachLegalIntelligence(base, knownAgreementText, () => { throw new Error('synthetic legal analysis failure'); });
  assert.equal(result.financial.monthly_rental, 3500);
  assert.equal(result.tenant.name, 'Test Tenant');
  assert.deepEqual(result.clauses, []);
  assert.match(result.warnings.join(' '), /Legal analysis was unavailable/);
});

test('non-JSON upstream responses are classified without exposing a full body', async () => {
  await assert.rejects(
    () => readJsonApiResponse(new Response('<html><body>Function crash for test@example.com 0123456789</body></html>', {
      status: 504,
      headers: { 'Content-Type': 'text/html', 'x-vercel-id': 'sfo1::request-123' }
    })),
    (error: unknown) => {
      assert.ok(error instanceof JsonApiResponseError);
      assert.equal(error.details.status, 504);
      assert.equal(error.details.contentType, 'text/html');
      assert.equal(error.details.requestId, 'sfo1::request-123');
      assert.doesNotMatch(error.details.bodyPrefix, /test@example\.com|0123456789/);
      return true;
    }
  );
});

test('upload route uses the Node runtime and bounded AI work before Vercel timeout', () => {
  const route = readFileSync('app/api/tenancy-import/upload/route.ts', 'utf8');
  const handler = readFileSync('lib/tenancy/tenancyUploadHandler.ts', 'utf8');
  const extraction = readFileSync('lib/ai/extractTenancy.ts', 'utf8');
  const ocr = readFileSync('lib/ocr/openAiOcr.ts', 'utf8');
  assert.match(route, /export const runtime = 'nodejs'/);
  assert.match(route, /export const maxDuration = 300/);
  assert.match(handler, /timeoutMs: 120_000/);
  assert.match(handler, /maxAttempts: 2/);
  assert.match(handler, /maxOutputTokens: 6_000/);
  assert.match(extraction, /maxOutputTokens: input\.maxOutputTokens \?\? 12_000/);
  assert.match(ocr, /timeoutMs: 90_000, maxRetries: 0/);
});

function createHandler(extract: () => Promise<any>) {
  const query = { eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
  const supabase = {
    from: () => ({ select: () => query }),
    storage: { from: () => ({ upload: async () => ({ data: { path: 'stored-path' }, error: null }), remove: async () => ({ error: null }) }) },
    rpc: async () => ({ data: { document: { id: 'document-1' }, extraction: { id: 'extraction-1' } }, error: null })
  };
  return createTenancyUploadHandler({
    extractTenancyFile: extract as never,
    requireWorkspaceAccess: async () => ({ supabase, user: { id: 'user-1' }, workspaceId: 'workspace-test', role: 'owner' }) as never,
    workspaceStoragePath: () => 'workspace-test/tenancy-agreements/known-agreement.txt'
  });
}

async function upload(file: File) {
  return post(createHandler(async () => extractionFixture()), file);
}

async function post(handler: ReturnType<typeof createTenancyUploadHandler>, file: File) {
  const body = new FormData();
  body.append('file', file);
  return handler(new Request('https://nexora.test/api/tenancy-import/upload', { method: 'POST', body }));
}

async function assertUploadFailure(response: Response, status: number, stage: string, code: string) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).filter((key) => ['success', 'stage', 'code', 'error', 'requestId'].includes(key)), ['success', 'stage', 'code', 'error', 'requestId']);
  assert.equal(body.success, false);
  assert.equal(body.stage, stage);
  assert.equal(body.code, code);
  assert.ok(body.requestId);
}

function extractionFixture() {
  const legalIntelligence = legalExtraction();
  return {
    rawText: knownAgreementText,
    summary: 'Known tenancy agreement.',
    provider: 'openai' as const,
    fallbackUsed: false,
    fallbackReason: null,
    document: {
      originalFilename: 'known-agreement.txt', documentType: 'TXT Tenancy Agreement', usedOcr: false,
      pageCount: null, model: 'gpt-5.5', chunkCount: 1
    },
    legalIntelligence
  };
}

function legalExtraction(): TenancyLegalIntelligence {
  return {
    document_type: 'Residential', confidence: 0.95,
    tenant: { name: 'Test Tenant', company: '', ic_passport: '', phone: '', email: '' },
    landlord: { name: 'Test Landlord', company: '', ic_passport: '', phone: '', email: '' },
    property: { name: 'Known Residence', unit: 'A-1', address: 'Kuala Lumpur', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
    financial: { monthly_rental: 3500, security_deposit: 7000, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 350 },
    tenancy: { commencement_date: '2026-07-01', expiry_date: '2028-06-30', renewal_option: '', notice_period: '2 months', payment_due_day: '1' },
    utilities: { tnb: '', water: '', iwk: '', wifi: '' },
    legal: { signatures: '', witnesses: 'Witness', stamp_duty: 'RM 350', inventory: '', restrictions: [], late_payment: '', termination: '2 months', viewing_rights: '24 hours', insurance: '', maintenance: '', access_card: '', car_park: '' },
    clauses: [], special_clauses: [], risks: [], warnings: [], field_confidence: {}, field_evidence: {}
  };
}
