import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCollectionOverview, normalizeAccountNumber } from '../lib/collections/live';

test('maps zero live records to empty overview without fake fallback', () => {
  const overview = buildCollectionOverview({
    tenancies: [],
    collections: [],
    payments: [],
    utilityAccounts: [],
    utilityBills: [],
    reminders: [],
    followups: [],
    month: '2026-07',
    todayIso: '2026-07-13',
    language: 'en'
  });

  assert.equal(overview.rows.length, 0);
  assert.equal(overview.metrics.totalDueThisMonth, 0);
  assert.equal(overview.metrics.tenanciesMissingUtilityAccounts, 0);
});

test('calculates monthly KPIs from live-like rows and payment ledger', () => {
  const overview = buildCollectionOverview({
    tenancies: [{
      id: 'tenancy-live-1',
      tenant: 'Tenant',
      landlord: 'Landlord',
      property: 'Property',
      unit_no: 'A-1',
      monthly_rental: 3000,
      expiry_date: '2026-12-31',
      status: 'active',
      auto_generate_collections: true
    }],
    collections: [{
      id: 'collection-live-1',
      tenancy_id: 'tenancy-live-1',
      collection_month: '2026-07-01',
      due_date: '2026-07-01',
      rental_amount: 3000,
      tnb_amount: 100,
      payment_status: 'outstanding'
    }],
    payments: [{
      id: 'payment-live-1',
      rental_collection_id: 'collection-live-1',
      amount: 1000,
      payment_date: '2026-07-02',
      payment_method: 'bank_transfer',
      transaction_type: 'payment'
    }, {
      id: 'reversal-live-1',
      rental_collection_id: 'collection-live-1',
      amount: 100,
      payment_date: '2026-07-03',
      payment_method: 'bank_transfer',
      transaction_type: 'reversal'
    }],
    utilityAccounts: [],
    utilityBills: [{ id: 'bill-live-1', rental_collection_id: 'collection-live-1', review_status: 'pending_review' }],
    reminders: [{ id: 'reminder-live-1', rental_collection_id: 'collection-live-1', created_at: '2026-07-04' }],
    followups: [{ id: 'follow-live-1', rental_collection_id: 'collection-live-1', followup_status: 'snoozed', snoozed_until: '2026-07-15' }],
    month: '2026-07',
    todayIso: '2026-07-13',
    language: 'en'
  });

  assert.equal(overview.metrics.totalDueThisMonth, 3100);
  assert.equal(overview.metrics.collectedThisMonth, 900);
  assert.equal(overview.metrics.outstandingThisMonth, 2200);
  assert.equal(overview.metrics.utilityBillsAwaitingReview, 1);
  assert.equal(overview.rows[0].reminderCount, 1);
  assert.equal(overview.rows[0].followupStatus, 'snoozed');
});

test('normalizes account numbers for duplicate prevention and history matching', () => {
  assert.equal(normalizeAccountNumber(' 2200-9988 7766 '), '220099887766');
  assert.equal(normalizeAccountNumber('unifi 88-2211'), 'UNIFI882211');
});
