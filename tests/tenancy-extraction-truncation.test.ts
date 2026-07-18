import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractTenancyText } from '../lib/ai/extractTenancy';
import { extractTenancyDetails } from '../lib/tenancy/parser';
import { extractionOutputLimits, normalizeCanonicalTenancyExtraction } from '../lib/ai/tenancyExtractionContract';
import { mapTenancyExtractionToForm } from '../lib/tenancy/mapTenancyExtractionToForm';

function canonicalFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    document: { type: 'Residential', language: 'English', summary: 'Compact tenancy summary.' },
    confidence: 0.92,
    tenant: { name: 'Compact Tenant', identification: '900101-14-1234', phone: '012-3456789', email: 'tenant@example.com' },
    landlord: { name: 'Compact Landlord', identification: '680101-10-4321', phone: '019-8765432', email: 'landlord@example.com' },
    property: { name: 'Compact Residence', unit_number: '12-05', address: 'Jalan Compact, 50000 Kuala Lumpur', property_type: 'Residential' },
    financial: { monthly_rental: 3500, security_deposit: 7000, utility_deposit: 1750, access_card_deposit: null, car_park_deposit: null, holding_deposit: null, booking_fee: null, stamp_duty: null },
    tenancy: { commencement_date: '2026-09-01', expiry_date: '2027-08-31', renewal_option: '', renewal_period: '', automatic_renewal: '', notice_period: '2 months', payment_due_day: '1' },
    utilities: { tnb: 'Tenant', water: 'Tenant', iwk: 'Tenant', wifi: 'Tenant' },
    legal: { signatures: 'Signed', witnesses: 'Witness present', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: '2 months notice', viewing_rights: '', insurance: '', maintenance: '', access_card: '', car_park: '' },
    contacts: [], clauses: [], risks: [], warnings: [],
    ...overrides
  };
}

function structuredResponse(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(payload) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

const normalDocumentText = `--- PAGE 1 ---\nMALAYSIAN TENANCY AGREEMENT\nTenant: Compact Tenant\nLandlord: Compact Landlord\nMonthly rental: RM 3,500\nSecurity deposit: RM 7,000\nCommencement: 01/09/2026\nExpiry: 31/08/2027\n${'Ordinary tenancy clause wording. '.repeat(25)}`;

test('a normal tenancy agreement completes untruncated in one call with the 16k output budget', async () => {
  let calls = 0;
  let sentLimit = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? '{}')) as { max_output_tokens?: number };
    sentLimit = Number(body.max_output_tokens ?? 0);
    return structuredResponse(canonicalFor());
  };
  const result = await extractTenancyText(normalDocumentText, 'compact.pdf', { apiKey: 'truncation-key', fetcher });
  assert.equal(calls, 1);
  assert.equal(result.aiCallCount, 1);
  assert.equal(sentLimit, 16_000);
  assert.equal(result.extraction.tenant.name, 'Compact Tenant');
});

test('the normal fixture never uses the deterministic fallback', async () => {
  const extraction = await extractTenancyDetails(normalDocumentText, 'compact.pdf', 'application/pdf', {
    apiKey: 'truncation-key', fetcher: async () => structuredResponse(canonicalFor())
  });
  assert.equal(extraction.provider, 'openai');
  assert.equal(extraction.fallbackUsed, false);
  assert.equal(extraction.fallbackReason, null);
  assert.equal(extraction.document.aiCallCount, 1);
});

test('core fields populate the tenancy form with DD/MM/YYYY dates', async () => {
  const extraction = await extractTenancyDetails(normalDocumentText, 'compact.pdf', 'application/pdf', {
    apiKey: 'truncation-key', fetcher: async () => structuredResponse(canonicalFor())
  });
  const form = mapTenancyExtractionToForm(extraction);
  assert.equal(form.tenantName, 'Compact Tenant');
  assert.equal(form.landlordName, 'Compact Landlord');
  assert.equal(String(form.monthlyRental), '3500');
  assert.equal(String(form.securityDeposit), '7000');
  assert.equal(form.commencementDate, '01/09/2026');
  assert.equal(form.expiryDate, '31/08/2027');
});

test('a truncated response makes exactly one call, is not retried, and falls back safely', async () => {
  let calls = 0;
  const truncated = async () => {
    calls += 1;
    return new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  await assert.rejects(
    extractTenancyText(normalDocumentText, 'truncated.pdf', { apiKey: 'truncation-key', fetcher: truncated }),
    /openai_truncated/
  );
  assert.equal(calls, 1);

  const fallback = await extractTenancyDetails(normalDocumentText, 'truncated.pdf', 'application/pdf', {
    apiKey: 'truncation-key', fetcher: truncated
  });
  assert.equal(fallback.provider, 'deterministic');
  assert.equal(fallback.fallbackReason, 'openai_truncated');
});

test('optional sections may be omitted without failure or extra calls', async () => {
  let calls = 0;
  const minimal = canonicalFor({ contacts: undefined, clauses: undefined, risks: undefined, warnings: undefined });
  delete minimal.contacts; delete minimal.clauses; delete minimal.risks; delete minimal.warnings;
  const result = await extractTenancyText(normalDocumentText, 'minimal.pdf', {
    apiKey: 'truncation-key',
    fetcher: async () => { calls += 1; return structuredResponse(minimal); }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.extraction.special_clauses, []);
  assert.equal(result.extraction.tenant.name, 'Compact Tenant');
});

test('long clause lists and long quotations are capped deterministically within the output limits', () => {
  const oversizedClause = 'The tenant covenants and agrees at all material times throughout the term hereby created '.repeat(12);
  const canonical = normalizeCanonicalTenancyExtraction(canonicalFor({
    clauses: Array.from({ length: extractionOutputLimits.specialClauses + 15 }, (_, index) => `${oversizedClause} clause number ${index + 1}.`),
    contacts: Array.from({ length: extractionOutputLimits.contacts + 10 }, (_, index) => ({ role: 'witness', represents: 'neutral', name: `Witness ${index + 1}`, phone: `01${index}2345678` })),
    risks: Array.from({ length: extractionOutputLimits.risks + 10 }, (_, index) => ({ code: `risk_${index}`, severity: 'low', category: 'legal', reason: 'reason', recommendation: 'review' })),
    warnings: Array.from({ length: extractionOutputLimits.warnings + 10 }, (_, index) => `Warning ${index + 1}`),
    inventory: { items: Array.from({ length: extractionOutputLimits.inventoryItems + 20 }, (_, index) => `Item ${index + 1}`), furnished: 'Fully furnished' },
    deposit_details: { security_deposit: { amount: 7000, basis: 'explicit_amount', rental_multiple: null, source_page: 2, source_excerpt: 'x'.repeat(600), confidence: 0.9, requires_review: false } }
  }));
  assert.equal(canonical.clauses.length, extractionOutputLimits.specialClauses);
  assert.ok(canonical.clauses.every((clause) => clause.length <= extractionOutputLimits.specialClauseCharacters));
  assert.equal(canonical.contacts.length, extractionOutputLimits.contacts);
  assert.equal(canonical.risks.length, extractionOutputLimits.risks);
  assert.equal(canonical.inventory.items.length, extractionOutputLimits.inventoryItems);
  assert.equal(canonical.deposit_details.security_deposit.source_excerpt.length, extractionOutputLimits.excerptCharacters);
  assert.equal(canonical.additional_clauses_available, true);
  assert.match(canonical.warnings.join(' '), /Additional special clauses/);
});

test('a clause list within the cap does not raise the additional-clauses flag', () => {
  const canonical = normalizeCanonicalTenancyExtraction(canonicalFor({ clauses: ['No pets allowed.', 'No subletting.'] }));
  assert.equal(canonical.additional_clauses_available, false);
  assert.doesNotMatch(canonical.warnings.join(' '), /Additional special clauses/);
});

test('truncation diagnostics log only safe metadata, never document text', () => {
  const client = readFileSync('lib/ai/openAiClient.ts', 'utf8');
  assert.match(client, /inputCharacterCount/);
  assert.match(client, /estimatedInputTokens/);
  assert.match(client, /maxOutputTokens/);
  assert.match(client, /incompleteReason/);
  assert.doesNotMatch(client, /prompt: request\.prompt.*logOpenAiDiagnostic|logOpenAiDiagnostic\([^)]*request\.prompt/);
  const compactPrompt = readFileSync('lib/ai/extractTenancy.ts', 'utf8');
  assert.match(compactPrompt, /Keep the output compact/);
  assert.match(compactPrompt, /at most 120 characters/);
});
