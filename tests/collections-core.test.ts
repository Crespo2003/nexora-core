import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectionTotal,
  extractUtilityBill,
  generateMonthlyCollections,
  ledgerAmountPaid,
  maskAccountNumber,
  outstandingBalance,
  renderTenantReminder,
  resolveCollectionStatus,
  urgencyLevel
} from '../lib/collections/core';
import type { SmartCollection, TenancySummary } from '../lib/collections/types';

const tenancy: TenancySummary = {
  id: 'tenancy-1',
  tenant: 'Synthetic Tenant',
  tenantPhone: '60000000000',
  preferredLanguage: 'bilingual',
  landlord: 'Synthetic Landlord',
  landlordPhone: '60000000001',
  assignedAgent: 'Nexora Agent',
  property: 'Synthetic Residence',
  unitNo: 'A-01-01',
  monthlyRental: 3000,
  expiryDate: '2026-12-31',
  status: 'active',
  rentalDueDay: 1,
  gracePeriodDays: 3,
  autoGenerateCollections: true,
  collectionStartMonth: '2026-07',
  collectionEndMonth: '2026-12'
};

const collection: SmartCollection = {
  id: 'collection-1',
  tenancyId: tenancy.id,
  collectionMonth: '2026-07',
  dueDate: '2026-07-01',
  rentalAmount: 3000,
  tnbAmount: 120,
  waterAmount: 30,
  iwkAmount: 8,
  wifiAmount: 99,
  aircondAmount: 0,
  otherCharges: 10,
  lateCharges: 50,
  adjustments: -20,
  status: 'outstanding',
  notes: '',
  reminderCount: 1,
  paymentLedger: [
    {
      id: 'payment-1',
      collectionId: 'collection-1',
      amount: 1000,
      paymentDate: '2026-07-03',
      paymentMethod: 'bank_transfer',
      paymentReference: 'REF1',
      receiptNumber: '',
      notes: '',
      transactionType: 'payment',
      createdAt: '2026-07-03'
    },
    {
      id: 'refund-1',
      collectionId: 'collection-1',
      amount: 100,
      paymentDate: '2026-07-04',
      paymentMethod: 'bank_transfer',
      paymentReference: 'REV1',
      receiptNumber: '',
      notes: '',
      transactionType: 'reversal',
      createdAt: '2026-07-04'
    }
  ],
  utilityBillIds: []
};

test('calculates total, ledger paid and outstanding balance', () => {
  assert.equal(collectionTotal(collection), 3297);
  assert.equal(ledgerAmountPaid(collection.paymentLedger), 900);
  assert.equal(outstandingBalance(collection), 2397);
});

test('does not count waivers and adjustments as cash paid', () => {
  assert.equal(ledgerAmountPaid([
    {
      id: 'payment-cash',
      collectionId: 'collection-1',
      amount: 1000,
      paymentDate: '2026-07-03',
      paymentMethod: 'bank_transfer',
      paymentReference: '',
      receiptNumber: '',
      notes: '',
      transactionType: 'payment',
      createdAt: '2026-07-03'
    },
    {
      id: 'waiver-ledger',
      collectionId: 'collection-1',
      amount: 200,
      paymentDate: '2026-07-04',
      paymentMethod: 'other',
      paymentReference: '',
      receiptNumber: '',
      notes: '',
      transactionType: 'waiver',
      createdAt: '2026-07-04'
    },
    {
      id: 'adjustment-ledger',
      collectionId: 'collection-1',
      amount: 50,
      paymentDate: '2026-07-05',
      paymentMethod: 'other',
      paymentReference: '',
      receiptNumber: '',
      notes: '',
      transactionType: 'adjustment',
      createdAt: '2026-07-05'
    },
    {
      id: 'refund-ledger',
      collectionId: 'collection-1',
      amount: 100,
      paymentDate: '2026-07-06',
      paymentMethod: 'bank_transfer',
      paymentReference: '',
      receiptNumber: '',
      notes: '',
      transactionType: 'refund',
      createdAt: '2026-07-06'
    }
  ]), 900);
});

test('detects overdue status and urgency level', () => {
  assert.equal(resolveCollectionStatus(collection, '2026-07-13'), 'partial');
  assert.equal(urgencyLevel(collection, '2026-07-13'), '8-14 days overdue');
});

test('prevents duplicate monthly generation for same tenancy', () => {
  const result = generateMonthlyCollections([tenancy], [collection], '2026-07', '2026-07-13');
  assert.equal(result.created.length, 0);
  assert.equal(result.skipped[0].reason, 'duplicate-month');
});

test('generates next month for active tenancy only', () => {
  const result = generateMonthlyCollections([tenancy, { ...tenancy, id: 'expired', status: 'expired' }], [], '2026-08', '2026-07-13');
  assert.deepEqual(result.created, [{ tenancyId: 'tenancy-1', collectionMonth: '2026-08' }]);
  assert.equal(result.skipped[0].reason, 'inactive-tenancy');
});

test('extracts utility bill details and masks account numbers', () => {
  const bill = extractUtilityBill('TNB Account No: 220099887766\nBill No: INV-1\nDue Date: 22/07/2026\nTotal Amount Due: RM388.20', 'synthetic.pdf');
  assert.equal(bill.provider, 'tnb');
  assert.equal(bill.accountNumber, '220099887766');
  assert.equal(bill.totalAmountDue, 388.2);
  assert.equal(maskAccountNumber(bill.accountNumber), '********7766');
});

test('renders bilingual reminder with utility values and dates', () => {
  const message = renderTenantReminder({
    tenant: tenancy,
    collection,
    accounts: [],
    language: 'bilingual',
    agentName: 'Nexora Agent'
  });
  assert.match(message, /Synthetic Tenant/);
  assert.match(message, /Outstanding/);
  assert.match(message, /未结余额/);
  assert.match(message, /01\/07\/2026/);
});
