import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractTenancyDetails } from '../lib/ai/tenancyExtractor';
import type { TenancyLegalIntelligence } from '../lib/ai/extractTenancy';
import { extractUtilityBill } from '../lib/collections/core';
import { extractDocumentText } from '../lib/documents/extractText';
import { maxDocumentPageCount, maxDocumentUploadBytes } from '../lib/documents/types';
import { validateExtensionMatchesMime, validateFileSignature } from '../lib/documents/upload';
import { FallbackOcrProvider } from '../lib/ocr/fallbackOcr';
import { OpenAiOcrProvider } from '../lib/ocr/openAiOcr';
import type { OcrProvider } from '../lib/ocr/ocrProvider';
import { checkUploadRateLimit, resetUploadRateLimitsForTests, uploadRateLimit } from '../lib/security/uploadRateLimit';

const syntheticAgreement = `
TENANCY AGREEMENT
Landlord: Synthetic Landlord
Landlord phone: +60120000001
Tenant: Synthetic Tenant
Tenant passport: A1234567
Tenant phone: +60120000002
Premises address: Unit 8, Synthetic Residence, Kuala Lumpur
Monthly rental: RM 2,500.00
Security deposit: RM 5,000.00
Utility deposit: RM 1,000.00
Access card deposit: RM 200.00
Car park remote deposit: RM 100.00
Commencement date: 01/07/2026
Expiry date: 30/06/2027
Rental due day: 1
Renewal option: One year
Notice period: Two months notice
Special clause: Synthetic fixture only.
`;

const completedOcr = (text: string): OcrProvider => ({ async extractText() { return { status: 'completed', text, error: '' }; } });
const failedOcr: OcrProvider = { async extractText() { return { status: 'failed', text: '', error: 'synthetic-unreadable' }; } };

const structuredAgreement: TenancyLegalIntelligence = {
  document_type: 'Residential', confidence: 0.96,
  tenant: { name: 'Synthetic Tenant', company: '', ic_passport: 'A1234567', phone: '+60120000002', email: '' },
  landlord: { name: 'Synthetic Landlord', company: '', ic_passport: '', phone: '+60120000001', email: '' },
  property: { name: 'Synthetic Residence', unit: '8', address: 'Unit 8, Synthetic Residence, Kuala Lumpur', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
  financial: { monthly_rental: 2500, security_deposit: 5000, utility_deposit: 1000, access_card_deposit: 200, car_park_deposit: 100, stamp_duty: 0 },
  tenancy: { commencement_date: '2026-07-01', expiry_date: '2027-06-30', renewal_option: 'One year', notice_period: 'Two months', payment_due_day: '1' },
  utilities: { tnb: '', water: '', iwk: '', wifi: '' },
  legal: { signatures: '', witnesses: '', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: 'Two months notice', viewing_rights: '', insurance: '', maintenance: '', access_card: '', car_park: '' },
  special_clauses: ['Synthetic fixture only.'], risks: [], warnings: [],
  field_confidence: { 'tenant.name': 98, 'financial.monthly_rental': 100, 'tenancy.renewal_option': 65 },
  field_evidence: {}
};

const structuredResponse = async () => new Response(JSON.stringify({
  status: 'completed',
  output: [{ content: [{ type: 'output_text', text: JSON.stringify({
    document: { type: structuredAgreement.document_type, language: 'English', summary: '' },
    confidence: structuredAgreement.confidence,
    tenant: { name: structuredAgreement.tenant.name, company: structuredAgreement.tenant.company, identification: structuredAgreement.tenant.ic_passport, phone: structuredAgreement.tenant.phone, email: structuredAgreement.tenant.email },
    landlord: { name: structuredAgreement.landlord.name, company: structuredAgreement.landlord.company, identification: structuredAgreement.landlord.ic_passport, phone: structuredAgreement.landlord.phone, email: structuredAgreement.landlord.email },
    property: { name: structuredAgreement.property.name, unit_number: structuredAgreement.property.unit, address: structuredAgreement.property.address, property_type: structuredAgreement.property.type, build_up: structuredAgreement.property.build_up, land_area: structuredAgreement.property.land_area, car_parks: structuredAgreement.property.car_parks }, financial: structuredAgreement.financial, tenancy: structuredAgreement.tenancy,
    utilities: structuredAgreement.utilities, legal: structuredAgreement.legal, clauses: structuredAgreement.special_clauses,
    risks: [], warnings: []
  }) }] }]
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('extracts the required tenancy agreement fields without inventing missing values', async () => {
  const extraction = await extractTenancyDetails(syntheticAgreement, 'synthetic-agreement.pdf', 'application/pdf', {
    apiKey: 'synthetic-key', fetcher: structuredResponse
  });
  assert.equal(extraction.landlord.name.value, 'Synthetic Landlord');
  assert.equal(extraction.tenant.idNo.value, 'A1234567');
  assert.equal(extraction.financial.monthlyRental.value, '2500');
  assert.equal(extraction.financial.carParkRemoteDeposit.value, '100');
  assert.equal(extraction.dates.rentalDueDay.value, '1');
  assert.equal(extraction.landlord.email.value, '');
  assert.equal(extraction.landlord.email.confidence, 'low');
});

test('processes a scanned tenancy agreement through an injected OCR provider', async () => {
  const result = await extractDocumentText({ buffer: Buffer.from('synthetic-image'), mimeType: 'image/png', filename: 'agreement.png' }, completedOcr(syntheticAgreement));
  assert.equal(result.status, 'completed');
  assert.equal(result.usedOcr, true);
  assert.match(result.text, /TENANCY AGREEMENT/);
});

test('extracts utility fields from a synthetic bill image transcription', async () => {
  const billText = 'TNB\nAccount Number: 123456789\nMeter Number: M123\nRegistered Name: Synthetic Tenant\nService Address: Synthetic Residence\nBill No: B10001\nBill Date: 01/07/2026\nBilling Period: July 2026\nDue Date: 20/07/2026\nTotal Amount Due: RM 180.50';
  const text = await extractDocumentText({ buffer: Buffer.from('synthetic-image'), mimeType: 'image/png', filename: 'tnb.png' }, completedOcr(billText));
  const extraction = extractUtilityBill(text.text, 'tnb.png');
  assert.equal(extraction.provider, 'tnb');
  assert.equal(extraction.accountNumber, '123456789');
  assert.equal(extraction.meterNumber, 'M123');
  assert.equal(extraction.totalAmountDue, 180.5);
});

test('reports missing OCR configuration and unreadable documents without fake success', async () => {
  const missing = await extractDocumentText({ buffer: Buffer.from('image'), mimeType: 'image/png', filename: 'scan.png' }, new FallbackOcrProvider());
  assert.equal(missing.status, 'not_configured');
  assert.equal(missing.text, '');
  const unreadable = await extractDocumentText({ buffer: Buffer.from('image'), mimeType: 'image/png', filename: 'scan.png' }, failedOcr);
  assert.equal(unreadable.status, 'failed');
  assert.equal(unreadable.error, 'synthetic-unreadable');
});

test('handles malformed OCR responses and provider timeout safely', async () => {
  const malformed: typeof fetch = async () => new Response(JSON.stringify({ output: [{ content: [{}] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  assert.equal((await new OpenAiOcrProvider('synthetic-key', 'gpt-4.1-mini', malformed).extractText({ buffer: Buffer.from('image'), mimeType: 'image/png', filename: 'scan.png' })).error, 'ocr-malformed-or-empty-response');
  const timeout: typeof fetch = async () => { throw new DOMException('Synthetic timeout', 'AbortError'); };
  assert.equal((await new OpenAiOcrProvider('synthetic-key', 'gpt-4.1-mini', timeout).extractText({ buffer: Buffer.from('image'), mimeType: 'image/png', filename: 'scan.png' })).error, 'ocr-provider-timeout');
});

test('enforces file signatures, extensions, size, page and duplicate foundations', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.equal(validateFileSignature(png, 'image/png'), true);
  assert.equal(validateExtensionMatchesMime('bill.png', 'image/png'), true);
  assert.equal(validateExtensionMatchesMime('bill.pdf', 'image/png'), false);
  assert.equal(maxDocumentUploadBytes, 10 * 1024 * 1024);
  assert.equal(maxDocumentPageCount, 100);
  assert.equal(createHash('sha256').update(png).digest('hex'), createHash('sha256').update(Buffer.from(png)).digest('hex'));
});

test('rate-limit foundation bounds uploads without automatic retries', () => {
  resetUploadRateLimitsForTests();
  const now = Date.now();
  for (let index = 0; index < uploadRateLimit.maxRequests; index += 1) assert.equal(checkUploadRateLimit('workspace:user', now + index).allowed, true);
  const blocked = checkUploadRateLimit('workspace:user', now + uploadRateLimit.maxRequests);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test('server OCR secret is absent from client code and public environment names', () => {
  const client = readFileSync('app/tenancies/[id]/tenancy-workspace.tsx', 'utf8');
  const example = readFileSync('.env.example', 'utf8');
  assert.equal(client.includes('OPENAI_API_KEY'), false);
  assert.equal(example.includes('NEXT_PUBLIC_OPENAI'), false);
  assert.match(example, /^OPENAI_API_KEY=$/m);
});
