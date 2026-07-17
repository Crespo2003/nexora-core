import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRiskEngine, enrichExtractedTenancyTerms, mapCanonicalTenancyExtraction, type TenancyLegalIntelligence } from '../lib/ai/extractTenancy';
import { normalizeCanonicalTenancyExtraction } from '../lib/ai/tenancyExtractionContract';
import { extractedTenancyContacts, syncExtractedTenancyContacts, type ContactSyncClient } from '../lib/contacts/syncTenancyContacts';
import { mapTenancyExtractionToForm } from '../lib/tenancy/mapTenancyExtractionToForm';

function baseExtraction(financial: Partial<TenancyLegalIntelligence['financial']> = {}): TenancyLegalIntelligence {
  return {
    document_type: 'Residential', confidence: 0.92,
    tenant: { name: 'AN XIN', company: '', ic_passport: '750514-14-5544', phone: '+60123456789', email: 'anxin@example.com' },
    landlord: { name: 'Lim Owner', company: '', ic_passport: '680101-10-1234', phone: '+60129876543', email: 'owner@example.com' },
    property: { name: 'Example Residence', unit: '12-05', address: 'Jalan Example, 50000 Kuala Lumpur', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
    financial: { monthly_rental: 4800, security_deposit: 0, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 0, ...financial },
    tenancy: { commencement_date: '2026-03-11', expiry_date: '2027-03-10', renewal_option: '', notice_period: '2 months', payment_due_day: '1' },
    utilities: { tnb: 'Tenant', water: 'Tenant', iwk: 'Tenant', wifi: 'Tenant' },
    legal: { signatures: 'Signed', witnesses: 'Witness', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: '2 months notice', viewing_rights: '24 hours notice', insurance: '', maintenance: 'Tenant minor repairs', access_card: '', car_park: '' },
    special_clauses: [], risks: [], warnings: [], field_confidence: {}, field_evidence: {}
  };
}

test('calculates Malaysian deposit multiples only when the agreement states a rental multiple', () => {
  const raw = `--- PAGE 1 ---\nMonthly Rental: RM 4,800.00\nSecurity Deposit shall be equal to Two (2) months' rental.\nUtility Deposit: Half month rental.`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction(), raw);
  assert.equal(enriched.financial.security_deposit, 9600);
  assert.equal(enriched.financial.utility_deposit, 2400);
  assert.equal(enriched.field_evidence['financial.security_deposit'].source_page, 1);
  assert.match(enriched.warnings.join(' '), /calculated from the stated 2-month rental multiple/i);
});

test('preserves an explicit deposit and flags a conflicting stated rental multiple for review', () => {
  const raw = `--- PAGE 2 ---\nMonthly Rental: RM 4,800.00\nSecurity Deposit: RM 9,500.00, equivalent to two months rental.`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction({ security_deposit: 9500 }), raw);
  const reviewed = applyRiskEngine(enriched, raw);
  assert.equal(reviewed.financial.security_deposit, 9500);
  assert.ok(reviewed.risks.some((risk) => risk.code === 'security_deposit_mismatch' && /Requires Review/.test(risk.reason) && risk.source_page === 2));
});

test('normalizes detailed Malaysian agreement intelligence without retaining labels in identity values', () => {
  const canonical = normalizeCanonicalTenancyExtraction({
    document: { type: 'Residential', language: 'English', summary: 'Agreement' }, confidence: 0.95,
    tenant: { name: 'A N XIN', company: '', identification: 'NRICNo:750514-14-5544', identification_type: 'NRIC', company_number: '', phone: '012-345 6789', email: 'ANXIN@EXAMPLE.COM', correspondence_address: 'Address: Jalan Tenant, 50000 Kuala Lumpur' },
    landlord: { name: 'Lim Owner', company: 'Owner Sdn Bhd', identification: 'Passport No: A1234567', identification_type: 'Passport', company_number: 'Company No: 202001234567', phone: '03-1234 5678', email: 'OWNER@EXAMPLE.COM', correspondence_address: '' },
    contacts: [{ role: 'witness', represents: 'neutral', name: 'W I T NESS', company: '', identification: 'NRIC: 800101-01-1234', identification_type: 'NRIC', company_number: '', phone: '012-111 2222', email: 'witness@example.com', correspondence_address: '', source_page: 4, source_excerpt: 'Witness: W I T NESS', confidence: 0.9 }],
    property: { name: 'Example Residence', unit_number: '12-05', address: '12-05 Example Residence, Jalan Example, 50000 Kuala Lumpur, Malaysia', street: 'Jalan Example', postcode: '50000', city: 'Kuala Lumpur', state: 'Kuala Lumpur', country: 'Malaysia', property_type: 'Residential', build_up: '', land_area: '', car_parks: '1' },
    financial: { monthly_rental: 4800, security_deposit: 'Two (2) months rental', utility_deposit: 'Half month rental', access_card_deposit: null, car_park_deposit: null, holding_deposit: null, booking_fee: null, stamp_duty: null },
    tenancy: { commencement_date: '11/03/2026', expiry_date: '10/03/2027', renewal_option: 'One year', renewal_period: '1 year', automatic_renewal: 'No', notice_period: '2 months', payment_due_day: '1' },
    payment: { method: 'bank transfer', bank_name: 'Maybank', account_number: 'Account No: 123 456 789', account_holder: 'L I M OWNER', late_payment_interest: '8 percent per annum', grace_period: '7 days' },
    utilities: { tnb: 'Tenant pays', water: 'Tenant pays', iwk: 'Included', wifi: 'Tenant pays', aircond: 'Tenant maintains', maintenance_fee: 'Landlord pays', quit_rent: 'Landlord pays', assessment: 'Landlord pays' },
    parking: { bays: '1', bay_numbers: 'B-12', access_cards: '2', remote_controls: '1', keys: '3' }, inventory: { items: ['Bed', 'Fridge'], furnished: 'Partly furnished' },
    clause_coverage: { pets: true, subletting: true, airbnb: false, illegal_business: true, termination: true, default: true, force_majeure: false, viewing_rights: true, landlord_access: true, deposit_refund: true, repairs: true, maintenance: true, insurance: false },
    legal: { signatures: 'Signed', witnesses: 'Witness', stamp_duty: '', inventory: 'Attached', restrictions: [], late_payment: '8% p.a.', termination: '2 months notice', viewing_rights: '24 hours notice', insurance: '', maintenance: 'Tenant minor repairs', access_card: '', car_park: '' },
    clauses: [], risks: [], warnings: []
  });
  const mapped = mapCanonicalTenancyExtraction(canonical);
  assert.equal(canonical.tenant.name, 'AN XIN');
  assert.equal(canonical.tenant.identification, '750514-14-5544');
  assert.equal(canonical.landlord.company_number, '202001234567');
  assert.equal(canonical.financial.security_deposit, 9600);
  assert.equal(canonical.financial.utility_deposit, 2400);
  assert.equal(mapped.property.postcode, '50000');
  assert.equal(mapped.payment.account_number, '123456789');
  assert.equal(mapped.contacts?.[0].name, 'WIT NESS');
});

test('derives tenant, landlord, witness, agent and law-firm contacts without duplicate tenant records', () => {
  const contacts = extractedTenancyContacts({
    confidence: 0.9,
    tenant: { name: 'Tenant', phone: '012-345 6789', email: 'tenant@example.com' },
    landlord: { name: 'Landlord', phone: '012-222 3333', email: 'landlord@example.com' },
    contacts: [
      { role: 'tenant', represents: 'tenant', name: 'Tenant', phone: '012-345 6789', email: 'tenant@example.com' },
      { role: 'witness', represents: 'neutral', name: 'Witness' },
      { role: 'agent', represents: 'landlord', name: 'Agent' },
      { role: 'law_firm', represents: 'neutral', company: 'Legal Chambers' }
    ]
  });
  assert.deepEqual(contacts.map((contact) => contact.role), ['tenant', 'landlord', 'witness', 'agent', 'law_firm']);
  assert.equal(contacts[0].phone, '+60123456789');
});

test('stores workspace-scoped extracted contacts and tenancy links without duplicate rows', async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = { contacts: [], contact_roles: [], tenancy_contacts: [] };
  const client = {
    from(table: keyof typeof rows) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters[column] = value; return query; },
        maybeSingle: async () => ({ data: rows[table].find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null, error: null }),
        insert: (value: Record<string, unknown>) => {
          const row = { id: `${table}-${rows[table].length + 1}`, ...value };
          rows[table].push(row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        }
      };
      return query;
    }
  } as unknown as ContactSyncClient;
  const extraction = {
    confidence: 0.9,
    tenant: { name: 'Tenant', phone: '012-345 6789', email: 'tenant@example.com' },
    landlord: { name: 'Landlord', phone: '012-222 3333', email: 'landlord@example.com' },
    contacts: [
      { role: 'witness', represents: 'neutral', name: 'Witness' },
      { role: 'agent', represents: 'landlord', name: 'Agent' },
      { role: 'law_firm', represents: 'neutral', company: 'Legal Chambers' }
    ]
  };
  const first = await syncExtractedTenancyContacts({ supabase: client, workspaceId: 'workspace-a', tenancyId: 'tenancy-a', extraction });
  const second = await syncExtractedTenancyContacts({ supabase: client, workspaceId: 'workspace-a', tenancyId: 'tenancy-a', extraction });
  assert.deepEqual(first, { linked: 5, warnings: [] });
  assert.deepEqual(second, { linked: 5, warnings: [] });
  assert.equal(rows.contacts.length, 5);
  assert.equal(rows.contact_roles.length, 5);
  assert.equal(rows.tenancy_contacts.length, 5);
});

test('maps structured agreement intelligence into the existing tenancy fields with Malaysian display formatting', () => {
  const legalIntelligence = {
    ...baseExtraction(),
    tenant: { ...baseExtraction().tenant, ic_passport: '750514141234', phone: '+60123456789' },
    property: { ...baseExtraction().property, car_parks: '' },
    contacts: [{ role: 'witness' as const, represents: 'neutral' as const, name: 'Witness One', company: '', ic_passport: '', phone: '', email: '', source_page: 3, source_excerpt: 'Witness: Witness One', confidence: 91 }],
    parking: { bays: '2', bay_numbers: 'B-12, B-13', access_cards: '2', remote_controls: '1', keys: '3' },
    inventory: { items: ['Bed', 'Fridge'], furnished: 'Furnished' },
    payment: { method: 'bank transfer', bank_name: 'Maybank', account_number: '123456789', account_holder: 'Lim Owner', late_payment_interest: '8% per annum', grace_period: '7 days' },
    legal: { ...baseExtraction().legal, witnesses: '', inventory: '', late_payment: '' }
  };
  const mapped = mapTenancyExtractionToForm({ legalIntelligence });
  assert.equal(mapped.tenantIdentification, '750514-14-1234');
  assert.equal(mapped.tenantPhone, '+60 12-345 6789');
  assert.equal(mapped.carParks, '2');
  assert.equal(mapped.witnesses, 'Witness One');
  assert.equal(mapped.inventory, 'Bed\nFridge');
  assert.equal(mapped.latePayment, '8% per annum');
});
