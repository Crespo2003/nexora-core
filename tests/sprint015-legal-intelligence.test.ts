import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildLegalIntelligence,
  clauseCategories,
  compareLegalIntelligence,
  searchClauses,
  type LegalClause
} from '../lib/legal-intelligence/core';
import { mapTenancyExtractionToForm } from '../lib/tenancy/mapTenancyExtractionToForm';

const root = process.cwd();
const sourceText = `--- PAGE 1 ---
MALAYSIAN TENANCY AGREEMENT
Tenant: Aisha Rahman (IC 900101-14-1234)
Landlord: Lim Properties Sdn Bhd (Company No. 12345)
Monthly rental: RM 3,500 payable on the 1st day of every month.
Security deposit: RM 7,000 being two months rental.
Utility deposit: RM 1,750.
The tenancy commences on 2026-07-01 and expires on 2028-06-30.
Renewal option: Tenant may renew for one year by giving two months written notice.
Termination: Either party may terminate by giving two months written notice.
Landlord may inspect the premises with prior written notice.
Tenant is responsible for utilities and minor repairs. Landlord is responsible for structural repairs.
An inventory is attached. Witness: Nurul Ahmad. Stamp duty: RM 120.
Tenant shall not sublet the premises. This Agreement is governed by the laws of Malaysia.`;

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    document_type: 'Residential', confidence: 0.93,
    tenant: { name: 'Aisha Rahman', company: '', ic_passport: '900101141234', phone: '', email: '' },
    landlord: { name: 'Lim Properties Sdn Bhd', company: 'Lim Properties Sdn Bhd', ic_passport: '12345', phone: '', email: '' },
    property: { name: 'Residence', unit: '', address: 'Kuala Lumpur', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
    financial: { monthly_rental: 3500, security_deposit: 7000, utility_deposit: 1750, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 120 },
    tenancy: { commencement_date: '2026-07-01', expiry_date: '2028-06-30', renewal_option: 'One year', notice_period: '2 months', payment_due_day: '1st day' },
    utilities: { tnb: 'Tenant', water: 'Tenant', iwk: 'Tenant', wifi: 'Tenant' },
    legal: { signatures: 'Signed', witnesses: 'Nurul Ahmad', stamp_duty: 'RM 120', inventory: 'Attached', restrictions: ['No subletting'], late_payment: '', termination: '2 months notice', viewing_rights: 'Prior written notice', insurance: '', maintenance: 'Tenant minor repairs; landlord structural repairs', access_card: '', car_park: '' },
    special_clauses: [], risks: [], warnings: [], field_confidence: {}, field_evidence: {},
    ...overrides
  };
}

function clause(category: LegalClause['category'], summary: string, id: string = category): LegalClause {
  return { id, category, title: category, summary, full_text: summary, source_page: 1, source_excerpt: summary, confidence: 95, risk_level: 'low', responsible_party: 'both', obligation: '', trigger: '', deadline: '', financial_impact: '', recommendation: '' };
}

test('1. covers every canonical clause category', () => {
  assert.equal(clauseCategories.length, 35);
  assert.ok(clauseCategories.includes('Force majeure / Act of God'));
  assert.ok(clauseCategories.includes('Special conditions'));
});

test('2. extracts the rental-payment clause with a source reference', () => {
  const analysis = buildLegalIntelligence(extraction(), sourceText);
  const rental = analysis.clauses.find((item) => item.category === 'Rental payment');
  assert.equal(rental?.source_page, 1);
  assert.match(rental?.source_excerpt ?? '', /Monthly rental/i);
});

test('3. extracts a renewal clause', () => assert.ok(buildLegalIntelligence(extraction(), sourceText).clauses.some((item) => item.category === 'Renewal')));
test('4. extracts a termination clause', () => assert.ok(buildLegalIntelligence(extraction(), sourceText).clauses.some((item) => item.category === 'Termination')));
test('5. extracts maintenance clauses', () => assert.ok(buildLegalIntelligence(extraction(), sourceText).clauses.some((item) => item.category === 'Repairs' || item.category === 'Structural maintenance')));
test('6. extracts utilities clauses', () => assert.ok(buildLegalIntelligence(extraction(), sourceText).clauses.some((item) => item.category === 'Utilities')));
test('7. extracts entry or viewing clauses', () => assert.ok(buildLegalIntelligence(extraction(), sourceText).clauses.some((item) => item.category === 'Viewing rights' || item.category === 'Entry and inspection')));

test('8. produces an executive legal summary', () => {
  const summary = buildLegalIntelligence(extraction(), sourceText).executive_summary;
  assert.match(summary, /RM3,500/);
  assert.match(summary, /medium-risk issues/i);
});

test('9. finds missing renewal, termination, notice, maintenance, utilities, inventory, witnessing, stamp-duty and inspection terms', () => {
  const result = buildLegalIntelligence(extraction({ legal: {}, financial: { monthly_rental: 0, security_deposit: 0, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 0 } }), 'Tenant: A\nLandlord: B\n--- PAGE 1 ---');
  const ids = result.risks.map((risk) => risk.rule_id);
  for (const id of ['missing_renewal_clause', 'missing_termination_clause', 'missing_notice_period', 'missing_structural_maintenance', 'missing_utility_responsibility', 'missing_inventory_schedule', 'missing_witness', 'missing_stamp_duty', 'missing_viewing_or_inspection_clause']) assert.ok(ids.includes(id));
});

test('10. detects conflicting rental values', () => {
  assert.ok(buildLegalIntelligence(extraction(), `${sourceText}\nMonthly rental RM 4,100.`).risks.some((risk) => risk.rule_id === 'conflicting_rental_amounts'));
});

test('11. detects an inconsistent security-deposit multiple', () => {
  assert.ok(buildLegalIntelligence(extraction({ financial: { monthly_rental: 3500, security_deposit: 6500, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 0 } }), sourceText).risks.some((risk) => risk.rule_id === 'security_deposit_multiple_mismatch'));
});

test('12. marks potentially one-sided access terms for legal review', () => {
  assert.ok(buildLegalIntelligence(extraction(), `${sourceText}\nLandlord may enter without prior notice.`).risks.some((risk) => risk.rule_id === 'unusual_entry_rights'));
});

test('13. keeps supplied AI clauses but normalizes their canonical shape', () => {
  const analysis = buildLegalIntelligence(extraction({ clauses: [{ category: 'Termination', summary: 'Tenant may terminate after 12 months.', source_page: 1, source_excerpt: 'Tenant may terminate after 12 months.', confidence: 81, risk_level: 'medium', responsible_party: 'tenant', obligation: 'Give notice', trigger: 'After 12 months', deadline: '2 months', financial_impact: '', recommendation: 'Review notice' }] }), sourceText);
  const supplied = analysis.clauses.find((item) => item.summary.includes('after 12 months'));
  assert.equal(supplied?.responsible_party, 'tenant');
  assert.equal(supplied?.deadline, '2 months');
});

test('14. supports category filtering', () => {
  const clauses = [clause('Rental payment', 'Rent due monthly'), clause('Termination', 'Two months notice')];
  assert.deepEqual(searchClauses(clauses, '', 'Financial').map((item) => item.category), ['Rental payment']);
});

test('15. supports text search across obligations and source excerpts', () => {
  const clauses = [clause('Termination', 'Two months notice', 'termination')];
  assert.equal(searchClauses(clauses, 'months notice').length, 1);
});

test('16. compares monthly-rental changes', () => {
  const a = buildLegalIntelligence(extraction(), sourceText);
  const b = buildLegalIntelligence(extraction({ financial: { ...extraction().financial, monthly_rental: 4100 } }), sourceText.replace('RM 3,500', 'RM 4,100'));
  assert.ok(compareLegalIntelligence(a, b).financial_changes.some((item) => item.title === 'Monthly rental'));
});

test('17. compares tenancy-date changes', () => {
  const a = buildLegalIntelligence(extraction(), sourceText);
  const b = buildLegalIntelligence(extraction({ tenancy: { ...extraction().tenancy, expiry_date: '2029-06-30' } }), sourceText.replace('2028-06-30', '2029-06-30'));
  assert.ok(compareLegalIntelligence(a, b).date_changes.some((item) => item.title === 'Expiry date'));
});

test('18. reports added clauses', () => {
  const a = buildLegalIntelligence(extraction({ clauses: [] }), sourceText);
  const b = buildLegalIntelligence(extraction({ clauses: [clause('Insurance', 'Tenant shall maintain insurance.', 'insurance')] }), sourceText);
  assert.ok(compareLegalIntelligence(a, b).added_clauses.some((item) => item.category === 'Insurance'));
});

test('19. reports removed clauses', () => {
  const a = buildLegalIntelligence(extraction({ clauses: [clause('Insurance', 'Tenant shall maintain insurance.', 'insurance')] }), sourceText);
  const b = buildLegalIntelligence(extraction({ clauses: [] }), sourceText);
  assert.ok(compareLegalIntelligence(a, b).removed_clauses.some((item) => item.category === 'Insurance'));
});

test('20. reports modified clauses', () => {
  const a = buildLegalIntelligence(extraction({ clauses: [clause('Termination', 'Two months notice', 'termination')] }), sourceText);
  const b = buildLegalIntelligence(extraction({ clauses: [clause('Termination', 'Six months notice', 'termination')] }), sourceText);
  assert.ok(compareLegalIntelligence(a, b).modified_clauses.some((item) => item.category === 'Termination'));
});

test('21. preserves Sprint 014 tenancy form mapping', () => {
  const mapped = mapTenancyExtractionToForm({ legalIntelligence: extraction(), summary: 'Agreement', rawText: sourceText, document: { originalFilename: 'agreement.pdf' } });
  assert.equal(mapped.monthlyRental, 3500);
  assert.equal(mapped.tenantName, 'Aisha Rahman');
});

test('22. persists analysis idempotently by workspace, document and extraction version', () => {
  const migration = readFileSync('supabase/migrations/202607170300_sprint_015_legal_intelligence.sql', 'utf8');
  assert.match(migration, /unique \(workspace_id, document_id, extraction_version\)/i);
  assert.match(migration, /on conflict \(workspace_id, document_id, extraction_version\) do update/i);
});

test('23. confines legal intelligence records and routes to the active workspace', () => {
  const migration = readFileSync('supabase/migrations/202607170300_sprint_015_legal_intelligence.sql', 'utf8');
  const compareRoute = readFileSync('app/api/tenancy-legal-intelligence/compare/route.ts', 'utf8');
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /private\.is_workspace_member\(workspace_id\)/i);
  assert.match(compareRoute, /requireWorkspaceAccess\(\['owner', 'admin', 'manager', 'agent'\], request\)/);
  assert.match(compareRoute, /\.eq\('workspace_id', auth\.workspaceId\)/);
});

test('24. keeps legal analysis server-side and avoids duplicate OpenAI extraction calls during comparison', () => {
  const compareRoute = readFileSync('app/api/tenancy-legal-intelligence/compare/route.ts', 'utf8');
  const uploadRoute = readFileSync('lib/tenancy/tenancyUploadHandler.ts', 'utf8');
  assert.doesNotMatch(compareRoute, /OPENAI_API_KEY|requestStructuredOpenAi|extractTenancyFile/);
  assert.match(compareRoute, /document_extractions/);
  assert.match(uploadRoute, /document_hash/);
});
