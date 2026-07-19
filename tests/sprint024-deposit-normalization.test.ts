import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichExtractedTenancyTerms, type TenancyLegalIntelligence } from '../lib/ai/extractTenancy';
import { normalizeMoney } from '../lib/tenancy/mapTenancyExtractionToForm';

function baseExtraction(financial: Partial<TenancyLegalIntelligence['financial']> = {}): TenancyLegalIntelligence {
  return {
    document_type: 'Residential', confidence: 0.92,
    tenant: { name: 'AN XIN', company: '', ic_passport: '750514-14-5544', phone: '+60123456789', email: 'anxin@example.com' },
    landlord: { name: 'Lim Owner', company: '', ic_passport: '680101-10-1234', phone: '+60129876543', email: 'owner@example.com' },
    property: { name: 'Example Residence', unit: '12-05', address: 'Jalan Example, 50000 Kuala Lumpur', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
    financial: { monthly_rental: 3600, security_deposit: 0, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 0, ...financial },
    tenancy: { commencement_date: '2026-03-11', expiry_date: '2027-03-10', renewal_option: '', notice_period: '2 months', payment_due_day: '1' },
    utilities: { tnb: 'Tenant', water: 'Tenant', iwk: 'Tenant', wifi: 'Tenant' },
    legal: { signatures: 'Signed', witnesses: 'Witness', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: '2 months notice', viewing_rights: '24 hours notice', insurance: '', maintenance: 'Tenant minor repairs', access_card: '', car_park: '' },
    special_clauses: [], risks: [], warnings: [], field_confidence: {}, field_evidence: {}
  };
}

// 1. RM 3,600 rent + a stated 2-month security deposit resolves to RM 7,200 (not RM 2).
test('RM 3,600 rent plus a two-month security deposit multiple derives RM 7,200', () => {
  const raw = `--- PAGE 1 ---\nMonthly Rental: RM 3,600.00\nSecurity Deposit: two (2) months' security deposit payable on signing.`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction({ security_deposit: 2 }), raw);
  assert.equal(enriched.financial.security_deposit, 7200);
  assert.equal(enriched.deposit_details?.security_deposit.basis, 'rental_multiple');
  assert.equal(enriched.deposit_details?.security_deposit.rental_multiple, 2);
  assert.equal(enriched.deposit_details?.security_deposit.calculated_amount, 7200);
});

// 2. RM 3,600 rent + a half-month utility deposit resolves to RM 1,800 (fractional multiple).
test('RM 3,600 rent plus a half-month utility deposit derives RM 1,800', () => {
  const raw = `--- PAGE 1 ---\nMonthly Rental: RM 3,600.00\nUtility Deposit: half (1/2) month utility deposit.`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction({ utility_deposit: 0.5 }), raw);
  assert.equal(enriched.financial.utility_deposit, 1800);
  assert.equal(enriched.deposit_details?.utility_deposit.rental_multiple, 0.5);
  assert.equal(enriched.deposit_details?.utility_deposit.calculated_amount, 1800);
});

// 3. The phrase "3 months" is never read as RM 3, and a bare numeric 3 against a large rental is rejected.
test('a rental multiple such as "3 months" is never parsed as RM 3', () => {
  assert.equal(normalizeMoney('3 months'), '');
  assert.equal(normalizeMoney('3 months', 3600), '');
  assert.equal(normalizeMoney("2 months' rental", 3600), 7200);
  assert.equal(normalizeMoney('RM 7,200.00'), 7200);

  const raw = `--- PAGE 1 ---\nMonthly Rental: RM 3,600.00\nThe security deposit and the utility deposit are payable to the Landlord on signing.`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction({ security_deposit: 3, utility_deposit: 3 }), raw);
  assert.equal(enriched.financial.security_deposit, null);
  assert.equal(enriched.financial.utility_deposit, null);
  assert.match(enriched.warnings.join(' '), /looks too small for a monthly rental/i);
});

// 4. An explicit RM amount wins over a calculated multiple when both are present and consistent.
test('an explicit RM amount takes priority over the calculated multiple', () => {
  const raw = `--- PAGE 1 ---\nMonthly Rental: RM 3,600.00\nSecurity Deposit: RM 7,200.00 (equivalent to two (2) months' rental).`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction({ security_deposit: 7200 }), raw);
  assert.equal(enriched.financial.security_deposit, 7200);
  assert.equal(enriched.deposit_details?.security_deposit.basis, 'explicit_amount');
  assert.equal(enriched.deposit_details?.security_deposit.requires_review, false);
});

// 5. A conflicting explicit amount and stated multiple keep the explicit value but raise a warning.
test('a conflicting explicit amount and stated multiple keep the amount and add a review warning', () => {
  const raw = `--- PAGE 1 ---\nMonthly Rental: RM 3,600.00\nSecurity Deposit: RM 7,000.00, being equivalent to two (2) months' rental.`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction({ security_deposit: 7000 }), raw);
  assert.equal(enriched.financial.security_deposit, 7000);
  assert.equal(enriched.deposit_details?.security_deposit.basis, 'explicit_amount');
  assert.equal(enriched.deposit_details?.security_deposit.requires_review, true);
  assert.equal(enriched.deposit_details?.security_deposit.calculated_amount, 7200);
  assert.match(enriched.warnings.join(' '), /conflicts with the stated 2-month rental multiple/i);
});

// 6. Zero remains allowed when the agreement truly states that no deposit is required.
test('an explicit zero deposit is preserved when the agreement states no deposit', () => {
  const raw = `--- PAGE 1 ---\nMonthly Rental: RM 3,600.00\nSecurity Deposit: RM 0.00 (no security deposit required).`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction({ security_deposit: 0 }), raw);
  assert.equal(enriched.financial.security_deposit, 0);
  assert.equal(enriched.deposit_details?.security_deposit.basis, 'explicit_amount');
  assert.equal(enriched.deposit_details?.security_deposit.requires_review, false);
});

// 7. Common Malaysian wordings each resolve to the correct multiple.
test('supports common Malaysian deposit wordings', () => {
  const cases: Array<[string, keyof TenancyLegalIntelligence['financial'], number]> = [
    [`Monthly Rental: RM 3,600.00\nSecurity Deposit: one (1) month security deposit.`, 'security_deposit', 3600],
    [`Monthly Rental: RM 3,600.00\nUtility Deposit: one (1) month utility deposit.`, 'utility_deposit', 3600],
    [`Monthly Rental: RM 3,600.00\nSecurity Deposit: a sum equivalent to two months' rental.`, 'security_deposit', 7200]
  ];
  for (const [body, field, expected] of cases) {
    const enriched = enrichExtractedTenancyTerms(baseExtraction(), `--- PAGE 1 ---\n${body}`);
    assert.equal(enriched.financial[field], expected, `${field} for: ${body}`);
  }
});

// 8. A tenancy term of "12 months" near a deposit label is not mistaken for a deposit multiple.
test('a 12-month tenancy term is not mistaken for a deposit multiple', () => {
  const raw = `--- PAGE 1 ---\nMonthly Rental: RM 3,600.00\nSecurity Deposit: RM 7,200.00. The term of the tenancy is 12 months.`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction({ security_deposit: 7200 }), raw);
  assert.equal(enriched.financial.security_deposit, 7200);
  assert.equal(enriched.deposit_details?.security_deposit.requires_review, false);
});

// 9. A suspicious deposit lowers the overall confidence so review is not skipped.
test('a rejected suspicious deposit lowers overall confidence', () => {
  const raw = `--- PAGE 1 ---\nMonthly Rental: RM 3,600.00\nSecurity deposit noted in the agreement.`;
  const enriched = enrichExtractedTenancyTerms(baseExtraction({ security_deposit: 3 }), raw);
  assert.equal(enriched.financial.security_deposit, null);
  assert.ok(enriched.confidence <= 0.6, `expected lowered confidence, got ${enriched.confidence}`);
});
