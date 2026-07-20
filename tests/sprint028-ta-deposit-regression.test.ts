import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichExtractedTenancyTerms, type TenancyLegalIntelligence } from '../lib/ai/extractTenancy';

function makeExtraction(financial: Partial<TenancyLegalIntelligence['financial']> = {}): TenancyLegalIntelligence {
  return {
    document_type: 'Residential', confidence: 0.92,
    tenant: { name: 'Test Tenant', company: '', ic_passport: '', phone: '', email: '' },
    landlord: { name: 'Test Landlord', company: '', ic_passport: '', phone: '', email: '' },
    property: { name: 'Test Property', unit: '', address: '', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
    financial: { monthly_rental: 3600, security_deposit: 0, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 0, ...financial },
    tenancy: { commencement_date: '2026-01-01', expiry_date: '2027-01-01', renewal_option: '', notice_period: '2 months', payment_due_day: '1' },
    utilities: { tnb: 'Tenant', water: 'Tenant', iwk: 'Tenant', wifi: 'Tenant' },
    legal: { signatures: '', witnesses: '', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: '', viewing_rights: '', insurance: '', maintenance: '', access_card: '', car_park: '' },
    special_clauses: [], risks: [], warnings: [], field_confidence: {}, field_evidence: {}
  };
}

// 1. Full TA.pdf scenario: explicit RM amounts override model-supplied values; absent car park → null.
test('TA.pdf scenario: security 2 months=7200, utility half=1800, access card 200, car park absent=null', () => {
  const raw = [
    '--- PAGE 1 ---',
    'Monthly Rental: RM 3,600.00 per month',
    "Security Deposit: two (2) months' security deposit payable upon signing, amounting to RM 7,200.00",
    'Utility Deposit: half (1/2) month utility deposit amounting to RM 1,800.00',
    'Access Card Deposit: RM 200.00',
    '',
    '--- PAGE 2 ---',
    'Term: 12 months commencing 1 January 2026',
  ].join('\n');

  const enriched = enrichExtractedTenancyTerms(makeExtraction({
    monthly_rental: 3600, security_deposit: 2, utility_deposit: 0.5, access_card_deposit: 3, car_park_deposit: 3600
  }), raw);

  assert.equal(enriched.financial.security_deposit, 7200, 'security deposit: explicit RM 7,200 wins over model-supplied 2');
  assert.equal(enriched.financial.utility_deposit, 1800, 'utility deposit: explicit RM 1,800 wins over model-supplied 0.5');
  assert.equal(enriched.financial.access_card_deposit, 200, 'access card: explicit RM 200');
  assert.equal(enriched.financial.car_park_deposit, null, 'car park: absent from document → null');
});

// 2. car_park_deposit hallucinated as monthly_rental is rejected when absent from document.
test('car_park_deposit equal to monthly_rental with no document evidence is rejected', () => {
  // Use deposit-label-specific wording so Pattern 3 only fires for security deposit, not car park.
  const raw = "--- PAGE 1 ---\nMonthly Rental: RM 3,600.00\nSecurity Deposit: two (2) months' security deposit.\n";
  const enriched = enrichExtractedTenancyTerms(makeExtraction({ car_park_deposit: 3600 }), raw);
  assert.equal(enriched.financial.car_park_deposit, null);
  assert.match(enriched.warnings.join(' '), /car park deposit/i);
  assert.match(enriched.warnings.join(' '), /monthly rental|model error/i);
});

// 3. car_park_deposit equalling monthly_rental is kept when the document explicitly states it.
test('car_park_deposit equal to monthly_rental is preserved when the document states it explicitly', () => {
  const raw = 'Monthly Rental: RM 3,600.00\nCar Park Deposit: RM 3,600.00.\n';
  const enriched = enrichExtractedTenancyTerms(makeExtraction({ car_park_deposit: 3600 }), raw);
  assert.equal(enriched.financial.car_park_deposit, 3600);
});

// 4. "RM 3,600" split across a PDF line break does not bypass the suspicious-amount guard.
test('line-broken RM 3,600 does not prevent isSuspiciousDepositAmount from catching model-supplied 3', () => {
  // Simulates a PDF where "RM 3,600.00" was extracted with a newline after "RM 3".
  const raw = '--- PAGE 1 ---\nMonthly Rental: RM 3\n,600.00\nSecurity Deposit: noted in the agreement.\n';
  const enriched = enrichExtractedTenancyTerms(makeExtraction({ security_deposit: 3 }), raw);
  assert.equal(enriched.financial.security_deposit, null,
    'broken "RM 3\\n,600" must not be read as standalone RM 3 when checking if model-supplied 3 is suspicious');
});

// 5. A genuinely small deposit stated explicitly in the document is preserved.
test('a genuine RM 3 access card deposit stated on the same line as the label is kept', () => {
  const raw = 'Monthly Rental: RM 3,600.00\nAccess Card Deposit: RM 3.00 per access card.\n';
  const enriched = enrichExtractedTenancyTerms(makeExtraction({ access_card_deposit: 3 }), raw);
  assert.equal(enriched.financial.access_card_deposit, 3,
    'explicit RM 3 on the access card deposit line must survive Rule 1 (explicit amount wins)');
});

// 6. Model returning bare-integer month counts for all deposits with no document evidence → all nulled.
test('model returning bare integer 3 for deposits with no document evidence → all nulled', () => {
  const raw = '--- PAGE 1 ---\nMonthly Rental: RM 3,600.00\nDeposit payable as stated in the schedule.\n';
  const enriched = enrichExtractedTenancyTerms(makeExtraction({
    security_deposit: 3, utility_deposit: 3, access_card_deposit: 3
  }), raw);
  assert.equal(enriched.financial.security_deposit, null, 'security: bare 3 without document evidence nulled');
  assert.equal(enriched.financial.utility_deposit, null, 'utility: bare 3 without document evidence nulled');
  assert.equal(enriched.financial.access_card_deposit, null, 'access card: bare 3 without document evidence nulled');
});

// 7. Monthly rental is never accepted as car_park_deposit when the document has no car park clause.
test('monthly_rental is never accepted as car_park_deposit when the agreement has no car park clause', () => {
  // Raw text mentions monthly rental but is silent on car park — no car park label at all.
  for (const rental of [1000, 2000, 3600, 5000, 8000]) {
    const raw = `Monthly Rental: RM ${rental.toLocaleString()}.00\nThe tenancy covers the above unit only.\n`;
    const enriched = enrichExtractedTenancyTerms(makeExtraction({ monthly_rental: rental, car_park_deposit: rental }), raw);
    assert.equal(enriched.financial.car_park_deposit, null,
      `car_park_deposit = monthly_rental = ${rental} must be rejected when no document evidence`);
  }
});

// 8. Rental multiple derivation still works after the fixes (regression guard for Rule 2).
test('rental-multiple derivation still produces correct values after fixes', () => {
  const raw = [
    'Monthly Rental: RM 3,600.00',
    "Security Deposit: two (2) months' security deposit.",
    'Utility Deposit: half (1/2) month utility deposit.',
  ].join('\n');
  const enriched = enrichExtractedTenancyTerms(makeExtraction({ security_deposit: 2, utility_deposit: 0.5 }), raw);
  assert.equal(enriched.financial.security_deposit, 7200, 'two months × 3600 = 7200');
  assert.equal(enriched.financial.utility_deposit, 1800, 'half month × 3600 = 1800');
});

// 9. Explicit amount beats rental multiple (Rule 1 priority), no regression after fixes.
test('explicit RM amount beats rental multiple after the fixes', () => {
  const raw = "Monthly Rental: RM 3,600.00\nSecurity Deposit: RM 7,200.00 (two (2) months' rental).\n";
  const enriched = enrichExtractedTenancyTerms(makeExtraction({ security_deposit: 7200 }), raw);
  assert.equal(enriched.financial.security_deposit, 7200);
  assert.equal(enriched.deposit_details?.security_deposit.basis, 'explicit_amount');
  assert.equal(enriched.deposit_details?.security_deposit.requires_review, false);
});
