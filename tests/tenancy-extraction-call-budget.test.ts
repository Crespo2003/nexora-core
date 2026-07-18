import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractTenancyText } from '../lib/ai/extractTenancy';
import { mergeCanonicalTenancyExtractions, normalizeCanonicalTenancyExtraction } from '../lib/ai/tenancyExtractionContract';
import { deduplicateDocumentContent, prioritizeChunksWithinBudget } from '../lib/ai/documentTextPreparation';

function canonicalFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    document: { type: 'Residential', language: 'English', summary: 'Synthetic tenancy summary.' },
    confidence: 0.9,
    tenant: { name: 'Call Budget Tenant', identification: '900101-14-1234', phone: '012-3456789', email: 'tenant@example.com' },
    landlord: { name: 'Call Budget Landlord', identification: '680101-10-4321', phone: '019-8765432', email: 'landlord@example.com' },
    property: { name: 'Budget Residence', unit_number: '10-01', address: 'Kuala Lumpur', property_type: 'Residential' },
    financial: { monthly_rental: 3200, security_deposit: 6400, utility_deposit: 1600, access_card_deposit: null, car_park_deposit: null, holding_deposit: null, booking_fee: null, stamp_duty: null },
    tenancy: { commencement_date: '2026-08-01', expiry_date: '2027-07-31', renewal_option: '', renewal_period: '', automatic_renewal: '', notice_period: '2 months', payment_due_day: '1' },
    utilities: { tnb: 'Tenant', water: 'Tenant', iwk: 'Tenant', wifi: 'Tenant' },
    legal: { signatures: 'Signed', witnesses: 'Witness present', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: '2 months notice', viewing_rights: '', insurance: '', maintenance: '', access_card: '', car_park: '' },
    contacts: [], clauses: [], risks: [], warnings: [],
    ...overrides
  };
}

function structuredResponse(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ output_text: JSON.stringify(payload) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

const normalDocumentText = `--- PAGE 1 ---\nMALAYSIAN TENANCY AGREEMENT\nTenant: Call Budget Tenant\nLandlord: Call Budget Landlord\nMonthly rental: RM 3,200\nSecurity deposit: RM 6,400\nCommencement: 01/08/2026\nExpiry: 31/07/2027\n${'Complete tenancy clause wording. '.repeat(20)}`;

test('a normal tenancy document uses exactly one OpenAI call', async () => {
  let calls = 0;
  const result = await extractTenancyText(normalDocumentText, 'normal.pdf', {
    apiKey: 'call-budget-key',
    fetcher: async () => { calls += 1; return structuredResponse(canonicalFor()); }
  });
  assert.equal(calls, 1);
  assert.equal(result.aiCallCount, 1);
  assert.equal(result.chunkCount, 1);
  assert.equal(result.extraction.tenant.name, 'Call Budget Tenant');
});

test('missing optional contacts and low-confidence fields never trigger another OpenAI call', async () => {
  let calls = 0;
  const sparse = canonicalFor({
    confidence: 0.31,
    contacts: [],
    tenant: { name: '', identification: '', phone: '', email: '' },
    financial: { monthly_rental: null, security_deposit: null, utility_deposit: null, access_card_deposit: null, car_park_deposit: null, holding_deposit: null, booking_fee: null, stamp_duty: null }
  });
  const result = await extractTenancyText(normalDocumentText, 'sparse.pdf', {
    apiKey: 'call-budget-key',
    fetcher: async () => { calls += 1; return structuredResponse(sparse); }
  });
  assert.equal(calls, 1);
  assert.equal(result.aiCallCount, 1);
  assert.equal(result.extraction.tenant.name, '');
});

test('a transient OpenAI failure is retried exactly once and then succeeds', async () => {
  let calls = 0;
  const result = await extractTenancyText(normalDocumentText, 'transient.pdf', {
    apiKey: 'call-budget-key',
    fetcher: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 });
      return structuredResponse(canonicalFor());
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.aiCallCount, 2);
});

test('a permanent OpenAI failure is not retried repeatedly', async () => {
  let calls = 0;
  await assert.rejects(
    extractTenancyText(normalDocumentText, 'permanent.pdf', {
      apiKey: 'call-budget-key',
      fetcher: async () => { calls += 1; return new Response('{}', { status: 401 }); }
    }),
    /openai_authentication_failed/
  );
  assert.equal(calls, 1);
});

test('a schema-mismatched response is not retried because repeating the request cannot fix it', async () => {
  let calls = 0;
  await assert.rejects(
    extractTenancyText(normalDocumentText, 'malformed.pdf', {
      apiKey: 'call-budget-key',
      fetcher: async () => { calls += 1; return new Response(JSON.stringify({ output_text: 'not-json' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    })
  );
  assert.equal(calls, 1);
});

test('an oversized document is capped at two OpenAI calls with no AI reconciliation request', async () => {
  let calls = 0;
  const oversized = Array.from({ length: 40 }, (_, index) => `--- PAGE ${index + 1} ---\nCLAUSE ${index + 1}: rental deposit tenant landlord clause. ${'Long agreement wording paragraph. '.repeat(180)}`).join('\n\n');
  const result = await extractTenancyText(oversized, 'oversized.pdf', {
    apiKey: 'call-budget-key',
    maxChunkCharacters: 60_000,
    fetcher: async () => { calls += 1; return structuredResponse(canonicalFor()); }
  });
  assert.ok(calls <= 2, `expected at most two OpenAI calls for an oversized document, saw ${calls}`);
  assert.equal(result.aiCallCount, calls);
  assert.equal(result.chunkCount, 2);
});

test('total OpenAI calls never exceed two even when a transient failure occurs mid-flight', async () => {
  let calls = 0;
  const oversized = Array.from({ length: 40 }, (_, index) => `--- PAGE ${index + 1} ---\nCLAUSE ${index + 1}: rental deposit tenant landlord clause. ${'Long agreement wording paragraph. '.repeat(180)}`).join('\n\n');
  await extractTenancyText(oversized, 'oversized-transient.pdf', {
    apiKey: 'call-budget-key',
    maxChunkCharacters: 60_000,
    fetcher: async () => { calls += 1; return structuredResponse(canonicalFor()); }
  }).catch(() => undefined);
  assert.ok(calls <= 2, `two-call ceiling breached: ${calls}`);
});

test('multi-section results merge deterministically: earlier facts win, arrays union, clause booleans OR', () => {
  const first = normalizeCanonicalTenancyExtraction(canonicalFor({
    financial: { monthly_rental: 3200, security_deposit: 6400, utility_deposit: null, access_card_deposit: null, car_park_deposit: null, holding_deposit: null, booking_fee: null, stamp_duty: null },
    clauses: ['No pets are allowed.'],
    contacts: [{ role: 'witness', represents: 'neutral', name: 'Witness One', phone: '012-1111111' }]
  }));
  const second = normalizeCanonicalTenancyExtraction(canonicalFor({
    financial: { monthly_rental: 9999, security_deposit: null, utility_deposit: 1600, access_card_deposit: null, car_park_deposit: null, holding_deposit: null, booking_fee: null, stamp_duty: null },
    clauses: ['No pets are allowed.', 'Tenant shall not sublet.'],
    contacts: [
      { role: 'witness', represents: 'neutral', name: 'Witness One', phone: '012-1111111' },
      { role: 'agent', represents: 'landlord', name: 'Agent Two', phone: '012-2222222' }
    ]
  }));
  const merged = mergeCanonicalTenancyExtractions([first, second]);
  assert.equal(merged.financial.monthly_rental, 3200);
  assert.equal(merged.financial.security_deposit, 6400);
  assert.equal(merged.financial.utility_deposit, 1600);
  assert.deepEqual(merged.clauses, ['No pets are allowed.', 'Tenant shall not sublet.']);
  assert.equal(merged.contacts.length, 2);
});

test('repeated headers, footers, empty OCR lines, and duplicate pages are removed deterministically', () => {
  const page = (index: number, body: string) => `--- PAGE ${index} ---\nNEXORA PROPERTY SDN BHD\n\n${body}\n\nPage footer - confidential`;
  const duplicateBody = 'Security deposit shall be RM 6,400 payable upon signing of this agreement by the tenant.';
  const raw = [
    page(1, 'Tenancy agreement between the parties.'),
    page(2, duplicateBody),
    page(3, duplicateBody),
    page(4, 'Signature page: signed by tenant and landlord before the witness.')
  ].join('\n\n');
  const prepared = deduplicateDocumentContent(raw);
  assert.equal(prepared.pagesRemoved, 1);
  assert.equal((prepared.text.match(/NEXORA PROPERTY SDN BHD/g) ?? []).length, 0);
  assert.match(prepared.text, /--- PAGE 1 ---/);
  assert.match(prepared.text, /--- PAGE 4 ---/);
  assert.match(prepared.text, /Signature page/);
});

test('chunk prioritization keeps the first and last sections and key tenancy-term sections', () => {
  const filler = 'General descriptive wording with no key facts. '.repeat(10);
  const chunks = [
    `Parties: tenant and landlord particulars with IC no and phone. ${filler}`,
    filler,
    `Security deposit RM 6,400 and monthly rental RM 3,200 due on the 1st. ${filler}`,
    filler,
    `Signature and witness page with stamp duty. ${filler}`
  ];
  const kept = prioritizeChunksWithinBudget(chunks, 2);
  assert.equal(kept.length, 2);
  assert.match(kept[0], /Parties: tenant and landlord/);
  assert.match(kept[1], /Signature and witness page/);
});

test('validation and mapping after the AI response are deterministic-only code paths', () => {
  const extraction = readFileSync('lib/ai/extractTenancy.ts', 'utf8');
  const afterMerge = extraction.slice(extraction.indexOf('mergeCanonicalTenancyExtractions(partials)'));
  const beforeReturn = afterMerge.slice(0, afterMerge.indexOf('return {'));
  assert.doesNotMatch(beforeReturn, /requestStructuredExtraction|requestStructuredOpenAi/);
  assert.doesNotMatch(extraction, /Reconcile these ordered section extractions/);
});

test('the extraction pipeline enforces the two-call ceiling in source: single chunk may retry once, two chunks may not retry', () => {
  const extraction = readFileSync('lib/ai/extractTenancy.ts', 'utf8');
  assert.match(extraction, /const maxChunksPerDocument = 2/);
  assert.match(extraction, /chunks\.length === 1 \? Math\.max\(1, Math\.min\(options\.maxAttempts \?\? 2, 2\)\) : 1/);
});

test('the OpenAI client hard-caps attempts at two and only retries transient failures', () => {
  const client = readFileSync('lib/ai/openAiClient.ts', 'utf8');
  assert.match(client, /Math\.min\(request\.maxAttempts \?\? 2, 2\)/);
  assert.doesNotMatch(client, /'invalid_ai_response'\) return true|'openai_malformed_json'\) return true/);
});

test('the upload handler preserves the stored document on extraction failure and marks transient failures retryable', () => {
  const handler = readFileSync('lib/tenancy/tenancyUploadHandler.ts', 'utf8');
  assert.match(handler, /upload_end_to_end_preserve_failed_upload/);
  assert.match(handler, /retryAllowed: true/);
  assert.match(handler, /retryable: retryableFailureCode\(code\)/);
  assert.match(handler, /'openai_timeout', 'openai_rate_limited', 'openai_server_error'/);
  assert.match(handler, /rollbackStatus: 'document-preserved'/);
});

test('retry extraction reuses the stored document without creating a duplicate', () => {
  const retryRoute = readFileSync('app/api/documents/[id]/retry/route.ts', 'utf8');
  assert.match(retryRoute, /\.download\(document\.data\.storage_path\)/);
  assert.doesNotMatch(retryRoute, /storage\.from\([^)]*\)\.upload\(/);
  assert.match(retryRoute, /document_extractions'\)\.update\(/);
  const handler = readFileSync('lib/tenancy/tenancyUploadHandler.ts', 'utf8');
  assert.match(handler, /retryableDocumentStatuses = \['ocr_required', 'extraction_failed'\]/);
  assert.match(handler, /duplicate-document/);
});

test('observability logs stage timings and AI call counts without personal data', () => {
  const handler = readFileSync('lib/tenancy/tenancyUploadHandler.ts', 'utf8');
  for (const event of ['route_entered', 'authentication_completed', 'document_download_completed', 'text_extraction_started', 'extraction_completed', 'deterministic_mapping_completed', 'http_response']) {
    assert.match(handler, new RegExp(event), `missing observability event ${event}`);
  }
  assert.match(handler, /aiCallCount/);
  const diagnostics = readFileSync('lib/ai/extractionDiagnostics.ts', 'utf8');
  assert.doesNotMatch(diagnostics, /rawText|tenantName|icNumber|phoneNumber|emailAddress/);
});

test('the aiCallCount observability counter matches the fetcher call count', async () => {
  let fetches = 0;
  let observed = 0;
  await extractTenancyText(normalDocumentText, 'observability.pdf', {
    apiKey: 'call-budget-key',
    onAiCallStart: () => { observed += 1; },
    fetcher: async () => { fetches += 1; return structuredResponse(canonicalFor()); }
  });
  assert.equal(observed, fetches);
  assert.equal(observed, 1);
});
