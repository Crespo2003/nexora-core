import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateDaysRemaining,
  collectionOutstanding,
  confidencePercent,
  sortTimeline,
  titleForActivity
} from '../lib/tenancy-workspace/core';
import { buildWorkspaceWarnings, paymentLedgerTotals, tenancyChangesFromExtraction } from '../lib/tenancy-workspace/automation';
import type { TenancyExtraction } from '../lib/ai/tenancyExtractor';

test('calculates tenancy expiry without local timezone drift', () => {
  assert.equal(calculateDaysRemaining('2026-07-24', new Date('2026-07-14T18:00:00+08:00')), 10);
  assert.equal(calculateDaysRemaining('2026-07-10', new Date('2026-07-14T18:00:00+08:00')), -4);
});

test('normalizes extraction confidence formats', () => {
  assert.equal(confidencePercent(0.93), 93);
  assert.equal(confidencePercent('medium'), 70);
  assert.equal(confidencePercent('82'), 82);
  assert.equal(confidencePercent(undefined), 0);
});

test('totals outstanding balances across collection history', () => {
  const collections = [
    { outstanding_balance: 125.5 },
    { outstanding_balance: 74.5 },
    { outstanding_balance: 0 }
  ] as Parameters<typeof collectionOutstanding>[0];
  assert.equal(collectionOutstanding(collections), 200);
});

test('keeps the newest tenancy activity first and gives it a readable title', () => {
  const events = [
    { id: '1', type: 'document_uploaded', title: '', detail: '', createdAt: '2026-07-13T00:00:00Z' },
    { id: '2', type: 'payment_recorded', title: '', detail: '', createdAt: '2026-07-14T00:00:00Z' }
  ];
  assert.equal(sortTimeline(events)[0].id, '2');
  assert.equal(titleForActivity('utility_account_updated'), 'Utility updated');
  assert.equal(titleForActivity('custom_activity'), 'Custom activity');
});

test('auto-populates reliable tenancy fields and leaves low-confidence values for review', () => {
  const field = (value: string, confidence: 'high' | 'medium' | 'low') => ({ value, confidence });
  const extraction = {
    property: { propertyName: field('Nexora Residence', 'high'), unitNo: field('A-12-3', 'medium'), fullAddress: field('', 'low'), propertyType: field('', 'low') },
    landlord: { name: field('Landlord One', 'medium'), idNo: field('', 'low'), phone: field('', 'low'), email: field('', 'low') },
    tenant: { name: field('Tenant One', 'high'), idNo: field('P123', 'low'), phone: field('', 'low'), email: field('', 'low') },
    financial: { monthlyRental: field('2500', 'high'), securityDeposit: field('5000', 'medium'), utilityDeposit: field('', 'low'), accessCardDeposit: field('', 'low'), carParkRemoteDeposit: field('', 'low') },
    dates: { commencementDate: field('01/07/2026', 'medium'), expiryDate: field('30/06/2027', 'medium'), renewalOption: field('', 'low'), noticePeriod: field('', 'low'), renewalReminder: field('', 'low') },
    clauses: { renewalClause: field('', 'low'), terminationClause: field('', 'low'), diplomaticClause: field('', 'low'), viewingClause: field('', 'low'), illegalActivityRestriction: field('', 'low'), petClause: field('', 'low'), specialClauses: field('', 'low'), otherObligations: field('', 'low') }
  } as unknown as TenancyExtraction;
  const result = tenancyChangesFromExtraction(extraction);
  assert.equal(result.changes.monthly_rental, 2500);
  assert.equal(result.changes.commencement_date, '2026-07-01');
  assert.equal(result.changes.tenant_id_no, undefined);
  assert.ok(result.lowConfidenceFields.includes('tenant_id_no'));
  assert.equal(tenancyChangesFromExtraction(extraction, true).changes.tenant_id_no, 'P123');
});

test('recalculates partial, overpayment, refund and reversal ledger totals', () => {
  assert.deepEqual(paymentLedgerTotals([{ amount: 1200, transaction_type: 'payment' }], 2000), { amountPaid: 1200, outstanding: 800, credit: 0 });
  assert.deepEqual(paymentLedgerTotals([{ amount: 2500, transaction_type: 'advance_payment' }], 2000), { amountPaid: 2500, outstanding: 0, credit: 500 });
  assert.deepEqual(paymentLedgerTotals([{ amount: 2500, transaction_type: 'payment' }, { amount: 300, transaction_type: 'refund' }, { amount: 200, transaction_type: 'reversal' }], 2000), { amountPaid: 2000, outstanding: 0, credit: 0 });
});

test('builds expiry, outstanding, utility, bill-increase and document warnings', () => {
  const warnings = buildWorkspaceWarnings({
    today: new Date('2026-07-14T00:00:00Z'),
    tenancy: { expiry_date: '2026-08-13', tenant_identity_expiry: '2026-07-01', insurance_expiry: '2026-07-01' } as never,
    collections: [{ outstanding_balance: 900 }] as never,
    utilityAccounts: [{ provider: 'tnb' }] as never,
    utilityBills: [
      { provider: 'tnb', bill_date: '2026-07-01', total_amount_due: 150 },
      { provider: 'tnb', bill_date: '2026-06-01', total_amount_due: 100 }
    ],
    documents: []
  });
  const codes = warnings.map((warning) => warning.code);
  assert.ok(codes.includes('tenancy-expiring'));
  assert.ok(codes.includes('outstanding-rental'));
  assert.ok(codes.includes('large-bill-tnb'));
  assert.ok(codes.includes('expired-passport'));
  assert.ok(codes.includes('expired-insurance'));
});
