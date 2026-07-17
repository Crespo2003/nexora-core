import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  mapTenancyExtractionToForm,
  mergeMappedFormPreservingEdits,
  normalizeDateForInput,
  normalizeMoney
} from '../lib/tenancy/mapTenancyExtractionToForm';

function aiResponse(): Record<string, unknown> {
  return {
    legalIntelligence: {
      confidence: 0.91,
      tenant: {
        name: 'Aisha Rahman', company: 'Aisha Trading', ic_passport: '900101-14-1234',
        phone: '012-345 6789', email: 'AISHA@EXAMPLE.COM'
      },
      landlord: {
        name: 'Lim Wei', company: 'Lim Holdings', ic_passport: '810202-10-5678',
        phone: '+60 12 987 6543', email: 'lim@example.com'
      },
      property: {
        name: 'Nexora Residency', unit: 'A-12-3', address: '1 Jalan Ampang, 50450 Kuala Lumpur',
        type: 'Residential', build_up: '1,100 sq ft', land_area: '', car_parks: '2'
      },
      financial: {
        monthly_rental: 'RM 3,500.00', security_deposit: "2 months' rent", utility_deposit: 'RM 1,750',
        access_card_deposit: 'RM 100', car_park_deposit: '200', stamp_duty: 'RM 450'
      },
      tenancy: {
        commencement_date: '1 July 2026', expiry_date: '30/06/2028', renewal_option: '2-year renewal',
        notice_period: '2 months', payment_due_day: '7th day of each month'
      },
      utilities: { tnb: 'Tenant', water: 'Tenant', iwk: 'Landlord', wifi: 'Tenant' },
      legal: {
        witnesses: 'Witnessed by both parties', inventory: 'Inventory attached', late_payment: '8% p.a.',
        termination: 'Two months written notice', viewing_rights: '24 hours notice', maintenance: 'Tenant minor repairs',
        insurance: 'Landlord insures building'
      },
      special_clauses: ['No pets without consent'],
      risks: [{ severity: 'medium', reason: 'Stamp duty receipt is not attached', recommendation: 'Obtain the stamped agreement.' }],
      warnings: ['Review the utility meter readings.'],
      field_confidence: { 'tenant.name': 98, 'property.address': 73, 'financial.monthly_rental': 100 },
      field_evidence: {
        'tenant.name': { confidence: 98, source_page: 1, source_excerpt: 'Tenant: Aisha Rahman' },
        'property.address': { confidence: 73, source_page: 2, source_excerpt: '1 Jalan Ampang' }
      }
    },
    summary: 'A two-year residential tenancy.',
    rawText: 'Tenant: Aisha Rahman',
    document: { originalFilename: 'aisha-tenancy.pdf' }
  };
}

test('1. nested AI response maps into flat tenancy form fields', () => {
  const mapped = mapTenancyExtractionToForm(aiResponse(), { documentId: 'doc-1', workspaceId: 'workspace-a' });
  assert.equal(mapped.tenantCompany, 'Aisha Trading');
  assert.equal(mapped.landlordCompany, 'Lim Holdings');
  assert.equal(mapped.unitNumber, 'A-12-3');
  assert.equal(mapped.documentId, 'doc-1');
  assert.equal(mapped.workspaceId, 'workspace-a');
});

test('2. monthly rental strings normalize to Malaysian Ringgit numbers', () => {
  assert.equal(normalizeMoney('RM 3,500.00'), 3500);
});

test('3. security deposit multiples normalize using the monthly rental', () => {
  assert.equal(normalizeMoney("2 months' rent", 3500), 7000);
});

test('4. utility deposits normalize to numeric values', () => {
  assert.equal(mapTenancyExtractionToForm(aiResponse()).generalUtilityDeposit, 1750);
});

test('5. tenancy dates convert to the HTML date input format', () => {
  const mapped = mapTenancyExtractionToForm(aiResponse());
  assert.equal(mapped.commencementDate, '2026-07-01');
  assert.equal(mapped.expiryDate, '2028-06-30');
  assert.equal(normalizeDateForInput('31/02/2026'), '');
});

test('6. missing dates remain blank and never default to today', () => {
  const response = aiResponse();
  const legal = response.legalIntelligence as Record<string, unknown>;
  legal.tenancy = { commencement_date: '', expiry_date: '', renewal_option: '', notice_period: '', payment_due_day: '' };
  const mapped = mapTenancyExtractionToForm(response);
  assert.equal(mapped.commencementDate, '');
  assert.equal(mapped.expiryDate, '');
});

test('7. missing money stays blank rather than becoming a fake zero', () => {
  assert.equal(normalizeMoney(''), '');
  const response = aiResponse();
  const legal = response.legalIntelligence as Record<string, unknown>;
  legal.financial = { monthly_rental: 0, security_deposit: 0, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 0 };
  legal.field_confidence = {
    'financial.monthly_rental': 0, 'financial.security_deposit': 0, 'financial.utility_deposit': 0,
    'financial.access_card_deposit': 0, 'financial.car_park_deposit': 0, 'financial.stamp_duty': 0
  };
  legal.field_evidence = {};
  assert.equal(mapTenancyExtractionToForm(response).monthlyRental, '');
});

test('8. tenant and landlord names populate from their nested fields', () => {
  const mapped = mapTenancyExtractionToForm(aiResponse());
  assert.equal(mapped.tenantName, 'Aisha Rahman');
  assert.equal(mapped.landlordName, 'Lim Wei');
  assert.equal(mapped.tenantPhone, '+60123456789');
});

test('9. property address populates from the nested property object', () => {
  assert.equal(mapTenancyExtractionToForm(aiResponse()).fullAddress, '1 Jalan Ampang, 50450 Kuala Lumpur');
});

test('10. user corrections remain intact when newer AI data arrives', () => {
  const original = mapTenancyExtractionToForm(aiResponse());
  const edited = { ...original, tenantName: 'Corrected Tenant', monthlyRental: 3600 };
  const incoming = mapTenancyExtractionToForm(aiResponse());
  const merged = mergeMappedFormPreservingEdits(edited, incoming, new Set(['tenantName', 'monthlyRental']));
  assert.equal(merged.tenantName, 'Corrected Tenant');
  assert.equal(merged.monthlyRental, 3600);
});

test('11. populated fields below 80 confidence are flagged for review', () => {
  const mapped = mapTenancyExtractionToForm(aiResponse());
  assert.deepEqual(mapped.lowConfidenceFields, ['property.address']);
});

test('12. import save sends the mapped form values and AI review record', () => {
  const ui = readFileSync('app/rental-command-centre.tsx', 'utf8');
  assert.match(ui, /tenancy:\s*tenancyPayload\(form\)/);
  assert.match(ui, /finalReviewedValues:\s*reviewedValues\(form\)/);
  assert.match(ui, /rawText:\s*form\.rawText/);
});

test('13. confirm import rejects a client workspace that differs from the authenticated workspace', () => {
  const route = readFileSync('app/api/tenancy-import/confirm/route.ts', 'utf8');
  assert.match(route, /clientWorkspaceId && clientWorkspaceId !== workspaceId/);
  assert.match(route, /workspace-mismatch/);
});

test('14. dashboard data reloads after a successful AI import', () => {
  const ui = readFileSync('app/rental-command-centre.tsx', 'utf8');
  assert.match(ui, /setDocuments\([\s\S]*?await loadRentalData\(\)/);
});
