import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRiskEngine, enrichExtractedTenancyTerms, mapCanonicalTenancyExtraction, type TenancyLegalIntelligence } from '../lib/ai/extractTenancy';
import { normalizeCanonicalTenancyExtraction } from '../lib/ai/tenancyExtractionContract';
import { extractedTenancyContacts } from '../lib/contacts/syncTenancyContacts';

function baseExtraction(overrides: Partial<TenancyLegalIntelligence> = {}): TenancyLegalIntelligence {
  return {
    document_type: 'Residential', confidence: 0.9,
    tenant: { name: 'AN XIN', company: '', ic_passport: '750514-14-5544', phone: '', email: 'anxin@example.com' },
    landlord: { name: 'Lim Owner', company: '', ic_passport: '680101-10-1234', phone: '', email: 'owner@example.com' },
    property: { name: 'Example Residence', unit: '12-05', address: 'Jalan Example, 50000 Kuala Lumpur', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
    financial: { monthly_rental: 4800, security_deposit: 0, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 0 },
    tenancy: { commencement_date: '2026-03-11', expiry_date: '2027-03-10', renewal_option: '', notice_period: '2 months', payment_due_day: '1' },
    utilities: { tnb: 'Tenant', water: 'Tenant', iwk: 'Tenant', wifi: 'Tenant' },
    legal: { signatures: 'Signed', witnesses: 'Witness', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: '2 months notice', viewing_rights: '24 hours notice', insurance: '', maintenance: 'Tenant minor repairs', access_card: '', car_park: '' },
    special_clauses: [], risks: [], warnings: [], field_confidence: {}, field_evidence: {},
    ...overrides
  };
}

test('canonical extraction normalization keeps mobile, office phone, and multi-phone/email arrays separate', () => {
  const canonical = normalizeCanonicalTenancyExtraction({
    document: { type: 'Residential', language: 'English', summary: '' }, confidence: 0.9,
    tenant: {
      name: 'Aisha Rahman', company: '', identification: '900101-14-5566', identification_type: 'NRIC', company_number: '',
      phone: '012-3456789', mobile: '012-3456789', office_phone: '03-22001100', additional_phones: ['019-8887777', '012-3456789'],
      email: 'aisha@example.com', additional_emails: ['aisha.rahman@work.example.com', 'aisha@example.com'],
      correspondence_address: ''
    },
    landlord: { name: '', company: '', identification: '', identification_type: '', company_number: '', phone: '', email: '', correspondence_address: '' },
    contacts: []
  });
  assert.equal(canonical.tenant.mobile, '012-3456789');
  assert.equal(canonical.tenant.office_phone, '03-22001100');
  assert.deepEqual(canonical.tenant.additional_phones, ['019-8887777']);
  assert.equal(canonical.tenant.email, 'aisha@example.com');
  assert.deepEqual(canonical.tenant.additional_emails, ['aisha.rahman@work.example.com']);
});

test('canonical extraction never fabricates a phone or email that was not supplied', () => {
  const canonical = normalizeCanonicalTenancyExtraction({
    document: {}, confidence: 0.9,
    tenant: { name: 'No Contact Tenant', company: '', identification: '', identification_type: '', company_number: '', phone: '', email: '', correspondence_address: '' },
    landlord: {}, contacts: []
  });
  assert.equal(canonical.tenant.mobile, '');
  assert.equal(canonical.tenant.office_phone, '');
  assert.deepEqual(canonical.tenant.additional_phones, []);
  assert.deepEqual(canonical.tenant.additional_emails, []);
});

test('canonical extraction rejects identifiers, dates, and currency mistaken for phone numbers', () => {
  const canonical = normalizeCanonicalTenancyExtraction({
    document: {}, confidence: 0.9,
    tenant: {
      name: 'Test Tenant', company: '', identification: '', identification_type: '', company_number: '',
      phone: '750514-14-5544', mobile: '18/07/2026', office_phone: 'RM 12,500', additional_phones: ['750514-14-5544'],
      email: '', correspondence_address: ''
    },
    landlord: {}, contacts: []
  });
  assert.equal(canonical.tenant.phone, '');
  assert.equal(canonical.tenant.mobile, '');
  assert.equal(canonical.tenant.office_phone, '');
  assert.deepEqual(canonical.tenant.additional_phones, []);
});

test('mapCanonicalTenancyExtraction carries mobile, office phone, and multi-phone/email arrays through to the party record', () => {
  const canonical = normalizeCanonicalTenancyExtraction({
    document: { type: 'Residential', language: 'English', summary: '' }, confidence: 0.9,
    tenant: {
      name: 'Aisha Rahman', company: '', identification: '900101-14-5566', identification_type: 'NRIC', company_number: '',
      phone: '', mobile: '012-3456789', office_phone: '03-22001100', additional_phones: ['019-8887777'],
      email: 'aisha@example.com', additional_emails: ['aisha.work@example.com'], correspondence_address: ''
    },
    landlord: {}, contacts: []
  });
  const mapped = mapCanonicalTenancyExtraction(canonical);
  assert.equal(mapped.tenant.mobile, '012-3456789');
  assert.equal(mapped.tenant.office_phone, '03-22001100');
  assert.deepEqual(mapped.tenant.additional_phones, ['019-8887777']);
  assert.deepEqual(mapped.tenant.additional_emails, ['aisha.work@example.com']);
  assert.equal(mapped.field_confidence['tenant.mobile'] > 0, true);
  assert.equal(mapped.field_confidence['tenant.office_phone'] > 0, true);
});

test('deterministic enrichment detects a mobile number, an office number, and multiple emails from document text', () => {
  const raw = `--- PAGE 1 ---
TENANT
Name: AN XIN
Mobile No: 012-345 6789
Office Tel: 03-2201 8899
Email: anxin@example.com
Alternate email: an.xin.alt@example.com`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction(), raw);
  assert.equal(enriched.tenant.mobile, '+60123456789');
  assert.equal(enriched.tenant.office_phone, '+60322018899');
  assert.equal(enriched.tenant.phone, '+60123456789');
  assert.equal(enriched.tenant.email, 'anxin@example.com');
  assert.deepEqual(enriched.tenant.additional_emails, ['an.xin.alt@example.com']);
});

test('deterministic enrichment does not invent contact details that are absent from the document', () => {
  const raw = `--- PAGE 1 ---\nTENANT\nName: AN XIN\nAddress: Unit 12-05, Jalan Example.`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction(), raw);
  assert.equal(enriched.tenant.mobile, '');
  assert.equal(enriched.tenant.office_phone, '');
  assert.deepEqual(enriched.tenant.additional_phones, []);
  assert.deepEqual(enriched.tenant.additional_emails, []);
});

test('overall confidence rises with genuinely complete, well-sourced fields relative to a sparse extraction', () => {
  const sparse = baseExtraction({
    confidence: 0.95,
    tenant: { name: '', company: '', ic_passport: '', phone: '', email: '' },
    landlord: { name: '', company: '', ic_passport: '', phone: '', email: '' },
    field_confidence: {},
    field_evidence: {}
  });
  const sparseResult = applyRiskEngine(sparse, 'Minimal document text with almost nothing extracted.');

  const raw = 'Monthly Rental: RM 4,800.00. Security Deposit: RM 9,600.00 (two months). Tenant: AN XIN. Landlord: Lim Owner.';
  const complete = baseExtraction({
    confidence: 0.95,
    field_confidence: Object.fromEntries(['tenant.name', 'landlord.name', 'financial.monthly_rental'].map((path) => [path, 95])),
    field_evidence: {
      'tenant.name': { value: 'AN XIN', confidence: 95, source_page: 1, source_excerpt: 'Tenant: AN XIN' },
      'landlord.name': { value: 'Lim Owner', confidence: 95, source_page: 1, source_excerpt: 'Landlord: Lim Owner' },
      'financial.monthly_rental': { value: '4800', confidence: 95, source_page: 1, source_excerpt: 'Monthly Rental: RM 4,800.00' }
    }
  });
  const completeResult = applyRiskEngine(complete, raw);

  assert.ok(
    completeResult.confidence > sparseResult.confidence,
    `expected a well-sourced extraction (${completeResult.confidence}) to score above a sparse one (${sparseResult.confidence})`
  );
});

test('syncTenancyContacts candidate extraction preserves mobile, office phone, and multi-phone/email arrays', () => {
  const candidates = extractedTenancyContacts({
    tenant: {
      name: 'Aisha Rahman', phone: '', mobile: '012-3456789', office_phone: '03-2201 8899',
      additional_phones: ['019-8887777'], email: 'aisha@example.com', additional_emails: ['aisha.work@example.com']
    },
    landlord: {}
  });
  const tenant = candidates.find((item) => item.role === 'tenant');
  assert.ok(tenant);
  assert.equal(tenant?.mobile, '+60123456789');
  assert.equal(tenant?.officePhone, '+60322018899');
  assert.deepEqual(tenant?.additionalPhones, ['+60198887777']);
  assert.deepEqual(tenant?.additionalEmails, ['aisha.work@example.com']);
});

test('syncTenancyContacts never fabricates mobile or office phone values that were not extracted', () => {
  const candidates = extractedTenancyContacts({ tenant: { name: 'No Contact Tenant' }, landlord: {} });
  const tenant = candidates.find((item) => item.role === 'tenant');
  assert.ok(tenant);
  assert.equal(tenant?.mobile, '');
  assert.equal(tenant?.officePhone, '');
  assert.deepEqual(tenant?.additionalPhones, []);
  assert.deepEqual(tenant?.additionalEmails, []);
});
