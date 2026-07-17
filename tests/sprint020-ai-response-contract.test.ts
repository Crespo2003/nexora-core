import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenAiTenancyResponseError,
  parseOpenAITenancyResponse
} from '../lib/ai/tenancyExtractionContract';
import { extractTenancyDeterministically } from '../lib/tenancy/deterministicParser';
import { mapTenancyExtractionToForm } from '../lib/tenancy/mapTenancyExtractionToForm';

const validExtraction = () => ({
  document: { type: 'Residential', language: 'English', summary: 'Residential tenancy.' },
  confidence: 0.96,
  tenant: { name: 'Aminah', company: '', identification: '900101141234', phone: '0123456789', email: 'aminah@example.com' },
  landlord: { name: 'Lim', company: '', identification: '', phone: '', email: '' },
  property: { name: '', unit_number: '', address: 'Kuala Lumpur', property_type: 'Residential', build_up: '', land_area: '', car_parks: '' },
  financial: { monthly_rental: 3500, security_deposit: 7000, utility_deposit: null, access_card_deposit: null, car_park_deposit: null, stamp_duty: null },
  tenancy: { commencement_date: '1 July 2026', expiry_date: '', renewal_option: '', notice_period: '', payment_due_day: '' },
  utilities: { tnb: '', water: '', iwk: '', wifi: '' },
  legal: { signatures: '', witnesses: '', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: '', viewing_rights: '', insurance: '', maintenance: '', access_card: '', car_park: '' },
  clauses: [],
  risks: [],
  warnings: []
});

function response(value: unknown, options: Record<string, unknown> = {}) {
  return {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    ...options
  };
}

function expectFailure(value: unknown, code: string): void {
  assert.throws(() => parseOpenAITenancyResponse(value), (error: unknown) => {
    assert.ok(error instanceof OpenAiTenancyResponseError);
    assert.equal(error.code, code);
    return true;
  });
}

test('accepts the structured Responses API output and safely normalizes optional fields', () => {
  const result = parseOpenAITenancyResponse(response(validExtraction()));
  assert.equal(result.financial.utility_deposit, null);
  assert.equal(result.property.name, '');
  assert.equal(result.property.unit_number, '');
  assert.equal(result.tenancy.commencement_date, '2026-07-01');
  assert.equal(result.financial.monthly_rental, 3500);
});

test('normalizes Malaysian money strings and rental multiples without inventing unsupported amounts', () => {
  const raw = validExtraction() as unknown as { financial: Record<string, unknown> };
  raw.financial = {
    monthly_rental: 'RM 43,000.00',
    security_deposit: '2 months rental',
    utility_deposit: 'one month utilities deposit',
    access_card_deposit: '',
    car_park_deposit: null,
    stamp_duty: null
  };
  const result = parseOpenAITenancyResponse(response(raw));
  assert.equal(result.financial.monthly_rental, 43000);
  assert.equal(result.financial.security_deposit, 86000);
  assert.equal(result.financial.utility_deposit, 43000);
  assert.equal(result.financial.access_card_deposit, null);
});

test('accepts one JSON fence but never relies on broad text scraping', () => {
  const payload = response(validExtraction());
  (payload.output[0].content[0] as { text: string }).text = `\`\`\`json\n${JSON.stringify(validExtraction())}\n\`\`\``;
  assert.equal(parseOpenAITenancyResponse(payload).tenant.name, 'Aminah');
});

test('classifies Responses API refusal, incomplete, empty, malformed, and schema failures precisely', () => {
  expectFailure({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'Cannot comply.' }] }] }, 'openai_refusal');
  expectFailure({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }, 'openai_truncated');
  expectFailure({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] }, 'openai_incomplete');
  expectFailure({ status: 'completed', output: [] }, 'openai_empty_response');
  expectFailure(response({ not: 'valid json shape' }), 'openai_schema_mismatch');
  expectFailure({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{not json' }] }] }, 'openai_malformed_json');
});

test('a deterministic fallback does not auto-populate low-confidence or unsafe values', () => {
  const fallback = extractTenancyDeterministically(
    `TENANCY AGREEMENT\nTenant: Name: Date: --- PAGE 1 ---\nLandlord: Name: Date: --- PAGE 2 ---\nSecurity Deposit: 86\n${'agreement wording '.repeat(12)}`,
    'unsafe.txt',
    'text/plain',
    'openai_schema_mismatch',
    true
  );
  const mapped = mapTenancyExtractionToForm(fallback);
  assert.equal(fallback.tenant.name.value, '');
  assert.equal(fallback.financial.securityDeposit.value, '');
  assert.equal(mapped.tenantName, '');
  assert.equal(mapped.securityDeposit, '');
  assert.match(mapped.warnings.join(' '), /deterministic fallback/i);
});
