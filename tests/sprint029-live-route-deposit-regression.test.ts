import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createTenancyUploadHandler } from '../lib/tenancy/tenancyUploadHandler';

const workspaceId = 'workspace-deposit-regression-029';

// TA-like text: deposit labels are followed by an amount line 3 lines below (blank + context line).
// This exercises the extended-lookahead fix (findExplicitDepositAmount j=1..3) together with
// the route-boundary normalization (normalizeFinalTenancyFinancials).
const taRawText = [
  'TENANCY AGREEMENT',
  '',
  'Monthly Rental: RM 3,600.00 per month',
  '',
  'THIRD SCHEDULE - DEPOSITS',
  '',
  'Security Deposits',
  '(2 months rental)',
  '',
  'Ringgit Malaysia (RM 7,200.00)',
  '',
  'General Utility Deposit',
  '(0.5 months rental)',
  '',
  'Ringgit Malaysia (RM 1,800.00)',
  '',
  'Access Card Deposit: RM 200.00',
].join('\n');

const taHash = createHash('sha256').update(Buffer.from(taRawText)).digest('hex');

function assertNormalizedDeposits(financial: Record<string, unknown> | undefined, context: string) {
  assert.equal(financial?.security_deposit, 7200, `${context}: security_deposit must be 7200`);
  assert.equal(financial?.utility_deposit, 1800, `${context}: utility_deposit must be 1800`);
  assert.equal(financial?.access_card_deposit, 200, `${context}: access_card_deposit must be 200`);
  assert.equal(financial?.car_park_deposit, null, `${context}: car_park_deposit must be null`);
}

test('fresh extraction: route boundary normalization corrects raw AI deposit values at HTTP response boundary', async () => {
  const handler = makeHandler({ document: null, extraction: null, link: null, extract: async () => mockExtraction(taRawText) });
  const payload = await postAndParse(handler);

  assertNormalizedDeposits(payload.extraction?.legalIntelligence?.financial, 'HTTP response (fresh)');
  // extraction.legalIntelligence is what the confirm route persists as extracted_json — must also be correct.
  assertNormalizedDeposits(payload.extraction?.legalIntelligence?.financial, 'persisted payload (fresh)');
});

test('stale extraction with empty rawText: forces fresh re-extraction and returns normalized values', async () => {
  const calls = { extraction: 0 };
  const handler = makeHandler({
    document: completedDocument(),
    extraction: staleExtraction({ raw_text: '' }),
    link: null,
    extract: async () => { calls.extraction += 1; return mockExtraction(taRawText); }
  });
  const payload = await postAndParse(handler);

  assert.equal(calls.extraction, 1, 'fresh AI extraction must run when stored rawText is empty');
  assertNormalizedDeposits(payload.extraction?.legalIntelligence?.financial, 'HTTP response (stale→recompute)');
  assertNormalizedDeposits(payload.extraction?.legalIntelligence?.financial, 'persisted payload (stale→recompute)');
});

test('stale extraction with rawText: re-enriches in place without AI re-extraction', async () => {
  const handler = makeHandler({
    document: completedDocument(),
    extraction: staleExtraction({ raw_text: taRawText }),
    link: { entity_id: 'tenancy-link-existing' },
    extract: async () => { throw new Error('Must not re-extract when valid rawText is stored.'); }
  });
  const payload = await postAndParse(handler);

  assert.equal(payload.reused, true);
  assertNormalizedDeposits(payload.extraction?.legalIntelligence?.financial, 'HTTP response (re-enriched stale)');
  assertNormalizedDeposits(payload.extraction?.legalIntelligence?.financial, 'persisted payload (re-enriched stale)');
});

// --- fixtures ---

function staleFinancials() {
  return {
    document_type: 'Residential', confidence: 0.85,
    tenant: { name: 'Test Tenant', company: '', ic_passport: '', phone: '', email: '' },
    landlord: { name: 'Test Landlord', company: '', ic_passport: '', phone: '', email: '' },
    property: { name: 'Test Property', unit: 'A-1', address: 'Kuala Lumpur', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
    financial: {
      monthly_rental: 3600,
      security_deposit: 3,   // wrong raw AI value — must become 7200 after normalization
      utility_deposit: 3,    // wrong raw AI value — must become 1800 after normalization
      access_card_deposit: 3, // wrong raw AI value — must become 200 after normalization
      car_park_deposit: 0,   // absent from document — must become null after normalization
      stamp_duty: 0
    },
    tenancy: { commencement_date: '2026-01-01', expiry_date: '2027-01-01', renewal_option: '', notice_period: '2 months', payment_due_day: '1' },
    utilities: { tnb: 'Tenant', water: 'Tenant', iwk: 'Tenant', wifi: 'Tenant' },
    legal: { signatures: '', witnesses: '', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: '', viewing_rights: '', insurance: '', maintenance: '', access_card: '', car_park: '' },
    special_clauses: [], risks: [], warnings: [], field_confidence: {}, field_evidence: {}
  };
}

function mockExtraction(rawText: string) {
  return {
    rawText,
    summary: 'Mock extraction for deposit regression test.',
    provider: 'openai' as const,
    fallbackUsed: false,
    fallbackReason: null,
    advancedAiConfigured: true,
    document: {
      originalFilename: 'TA.txt',
      uploadDate: '2026-07-22',
      documentType: 'tenancy_agreement',
      extractionStatus: 'ready' as const,
      extractionConfidence: 'high' as const,
      usedOcr: false,
      pageCount: 1,
      chunkCount: 1,
      aiCallCount: 1,
      model: 'gpt-5.5',
      fallbackReason: null
    },
    legalIntelligence: staleFinancials()  // wrong AI values; normalizeFinalTenancyFinancials must correct them
  };
}

function completedDocument() {
  return {
    id: 'document-ta-001',
    processing_status: 'extraction_completed',
    original_filename: 'TA.txt',
    sanitized_filename: 'ta-abc123.txt',
    storage_path: `${workspaceId}/tenancy-agreements/ta-abc123.txt`,
    mime_type: 'text/plain',
    file_size: Buffer.from(taRawText).length,
    document_type: 'tenancy_agreement',
    upload_status: 'uploaded',
    document_hash: taHash
  };
}

function staleExtraction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'extraction-stale-001',
    raw_text: '' as string | null,
    extracted_json: staleFinancials(),
    confidence_json: {},
    ai_summary: 'Stale extraction with wrong deposit values.',
    ai_model: 'gpt-5.5',
    extraction_engine: 'openai',
    extraction_status: 'extraction_completed',
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides
  };
}

// --- handler factory ---

function makeHandler(options: {
  document: Record<string, unknown> | null;
  extraction: Record<string, unknown> | null;
  link: Record<string, unknown> | null;
  extract: () => Promise<unknown>;
}) {
  const supabase = {
    from: (table: string) => ({
      select: () => {
        const data = table === 'documents'
          ? options.document
          : table === 'document_extractions'
            ? options.extraction
            : table === 'document_links'
              ? options.link
              : null;
        const q: Record<string, () => unknown> = {};
        const chain = () => q;
        q.eq = chain; q.in = chain; q.order = chain; q.limit = chain;
        q.maybeSingle = async () => ({ data, error: null });
        return q;
      }
    }),
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'test-storage-ref', id: 'storage-id' }, error: null }),
        remove: async () => ({ error: null })
      })
    },
    rpc: async () => ({ data: null, error: null })
  };

  return createTenancyUploadHandler({
    extractTenancyFile: options.extract as never,
    requireWorkspaceAccess: async () => ({ supabase, user: { id: 'user-test' }, workspaceId, role: 'owner' }) as never,
    workspaceStoragePath: () => `${workspaceId}/tenancy-agreements/ta-new.txt`,
    getOpenAiConfiguration: () => ({ configured: true, apiKey: 'test-key', tenancyModel: 'gpt-5.5' }) as never
  });
}

async function postAndParse(handler: ReturnType<typeof makeHandler>) {
  const body = new FormData();
  body.append('file', new File([taRawText], 'TA.txt', { type: 'text/plain' }));
  const response = await handler(new Request('https://nexora.test/api/tenancy-import/upload', { method: 'POST', body }));
  assert.equal(response.status, 200, `Expected 200 but got ${response.status}`);
  const payload = await response.json() as Record<string, any>;
  assert.equal(payload.success, true, 'payload.success must be true');
  return payload;
}
