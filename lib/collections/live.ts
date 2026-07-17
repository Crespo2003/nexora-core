import {
  collectionTotal,
  ledgerAmountPaid,
  maskAccountNumber,
  outstandingBalance,
  resolveCollectionStatus,
  urgencyLevel
} from './core';
import { addDaysToIsoDate } from '../dates/formatDate';
import type { CollectionPayment, Language, SmartCollection, TenancySummary, UtilityAccount, UtilityProvider } from './types';

export type CollectionOverviewInput = {
  tenancies: Array<Record<string, unknown>>;
  collections: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  utilityAccounts: Array<Record<string, unknown>>;
  utilityBills: Array<Record<string, unknown>>;
  reminders: Array<Record<string, unknown>>;
  followups: Array<Record<string, unknown>>;
  month: string;
  todayIso: string;
  language: Exclude<Language, 'bilingual'>;
};

export type CollectionOverviewRow = {
  collection: SmartCollection;
  tenancy: TenancySummary;
  accounts: UtilityAccount[];
  total: number;
  paid: number;
  outstanding: number;
  status: string;
  urgency: string;
  lastPaymentDate: string;
  lastReminderDate: string;
  reminderCount: number;
  followupStatus: string;
  nextFollowUpDate: string;
  pendingUtilityBills: number;
};

export type CollectionOverview = {
  rows: CollectionOverviewRow[];
  tenanciesWithoutCollections: TenancySummary[];
  metrics: {
    totalDueThisMonth: number;
    collectedThisMonth: number;
    outstandingThisMonth: number;
    overdueAmount: number;
    dueToday: number;
    dueWithin3Days: number;
    overdueTenancies: number;
    utilityBillsAwaitingUpload: number;
    utilityBillsAwaitingReview: number;
    tenanciesMissingUtilityAccounts: number;
    expiring30: number;
    expiring60: number;
    expiring90: number;
  };
};

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown) {
  return String(value ?? '');
}

export function normalizeAccountNumber(accountNumber: string) {
  return accountNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

export function mapTenancy(row: Record<string, unknown>): TenancySummary {
  return {
    id: str(row.id),
    tenant: str(row.tenant),
    tenantPhone: str(row.tenant_phone),
    preferredLanguage: (str(row.preferred_language) || 'en') as Language,
    landlord: str(row.landlord),
    landlordPhone: str(row.landlord_phone),
    assignedAgent: str(row.assigned_agent),
    property: str(row.property),
    unitNo: str(row.unit_no),
    monthlyRental: num(row.monthly_rental),
    expiryDate: str(row.expiry_date),
    status: str(row.status || 'active'),
    rentalDueDay: num(row.rental_due_day || 1),
    gracePeriodDays: num(row.grace_period_days),
    autoGenerateCollections: Boolean(row.auto_generate_collections),
    collectionStartMonth: str(row.collection_start_month).slice(0, 7),
    collectionEndMonth: str(row.collection_end_month).slice(0, 7)
  };
}

export function mapPayment(row: Record<string, unknown>): CollectionPayment {
  return {
    id: str(row.id),
    collectionId: str(row.rental_collection_id),
    amount: num(row.amount),
    paymentDate: str(row.payment_date),
    paymentMethod: str(row.payment_method) as CollectionPayment['paymentMethod'],
    paymentReference: str(row.payment_reference),
    receiptNumber: str(row.receipt_number),
    notes: str(row.notes),
    transactionType: str(row.transaction_type || 'payment') as CollectionPayment['transactionType'],
    createdAt: str(row.created_at)
  };
}

export function mapCollection(row: Record<string, unknown>, payments: CollectionPayment[], reminderCount: number, lastReminderDate = ''): SmartCollection {
  return {
    id: str(row.id),
    tenancyId: str(row.tenancy_id),
    collectionMonth: str(row.collection_month).slice(0, 7),
    dueDate: str(row.due_date),
    rentalAmount: num(row.rental_amount),
    tnbAmount: num(row.tnb_amount),
    waterAmount: num(row.water_amount),
    iwkAmount: num(row.iwk_amount),
    wifiAmount: num(row.wifi_amount),
    aircondAmount: num(row.aircond_amount),
    otherCharges: num(row.other_charges),
    lateCharges: num(row.late_charges),
    adjustments: num(row.adjustments),
    status: str(row.payment_status || 'outstanding') as SmartCollection['status'],
    notes: str(row.notes),
    lastReminderDate,
    reminderCount,
    paymentLedger: payments,
    utilityBillIds: []
  };
}

export function mapUtilityAccount(row: Record<string, unknown>, tenancy?: TenancySummary): UtilityAccount {
  const accountNumber = str(row.account_number);
  return {
    id: str(row.id),
    tenancyId: str(row.tenancy_id),
    propertyId: str(row.property_id),
    property: tenancy ? `${tenancy.property} ${tenancy.unitNo}`.trim() : str(row.billing_address),
    provider: str(row.provider || 'other') as UtilityProvider,
    accountNumber,
    accountNumberMasked: str(row.account_number_masked) || maskAccountNumber(accountNumber),
    meterNumber: str(row.meter_number),
    registeredName: str(row.registered_name),
    billingAddress: str(row.billing_address),
    recurringFee: num(row.recurring_fee),
    accountStatus: str(row.account_status || 'active') as UtilityAccount['accountStatus'],
    validFrom: str(row.valid_from),
    validTo: str(row.valid_to)
  };
}

export function buildCollectionOverview(input: CollectionOverviewInput): CollectionOverview {
  const tenancies = input.tenancies.map(mapTenancy);
  const payments = input.payments.map(mapPayment);
  const remindersByCollection = new Map<string, Array<Record<string, unknown>>>();
  const billsByCollection = new Map<string, Array<Record<string, unknown>>>();
  const followupByCollection = new Map<string, Record<string, unknown>>();

  input.reminders.forEach((reminder) => {
    const id = str(reminder.rental_collection_id);
    remindersByCollection.set(id, [...(remindersByCollection.get(id) ?? []), reminder]);
  });
  input.utilityBills.forEach((bill) => {
    const id = str(bill.rental_collection_id);
    if (id) billsByCollection.set(id, [...(billsByCollection.get(id) ?? []), bill]);
  });
  input.followups.forEach((followup) => followupByCollection.set(str(followup.rental_collection_id), followup));

  const accounts = input.utilityAccounts.map((account) => {
    const tenancy = tenancies.find((item) => item.id === str(account.tenancy_id));
    return mapUtilityAccount(account, tenancy);
  });

  const rows = input.collections.map((collectionRow) => {
    const collectionId = str(collectionRow.id);
    const collectionPayments = payments.filter((payment) => payment.collectionId === collectionId);
    const reminders = remindersByCollection.get(collectionId) ?? [];
    const lastReminderDate = reminders
      .map((reminder) => str(reminder.sent_at || reminder.created_at))
      .filter(Boolean)
      .sort()
      .at(-1) ?? '';
    const tenancy = tenancies.find((item) => item.id === str(collectionRow.tenancy_id)) ?? mapTenancy({});
    const collection = mapCollection(collectionRow, collectionPayments, reminders.length, lastReminderDate);
    const rowAccounts = accounts.filter((account) => account.tenancyId === tenancy.id && account.accountStatus === 'active');
    const rowBills = billsByCollection.get(collection.id) ?? [];
    const followup = followupByCollection.get(collection.id);
    const total = collectionTotal(collection);
    const paid = ledgerAmountPaid(collection.paymentLedger);
    const outstanding = outstandingBalance(collection);

    return {
      collection,
      tenancy,
      accounts: rowAccounts,
      total,
      paid,
      outstanding,
      status: resolveCollectionStatus(collection, input.todayIso),
      urgency: urgencyLevel(collection, input.todayIso, input.language),
      lastPaymentDate: collectionPayments.map((payment) => payment.paymentDate).filter(Boolean).sort().at(-1) ?? '',
      lastReminderDate,
      reminderCount: reminders.length,
      followupStatus: str(followup?.followup_status || ''),
      nextFollowUpDate: str(followup?.snoozed_until || followup?.promise_to_pay_date || ''),
      pendingUtilityBills: rowBills.filter((bill) => str(bill.review_status) !== 'confirmed').length
    };
  });

  const collectedThisMonth = rows.reduce((sum, row) => sum + row.paid, 0);
  const outstandingThisMonth = rows.reduce((sum, row) => sum + row.outstanding, 0);
  const dueWithin3Iso = addDaysToIsoDate(input.todayIso, 3) ?? input.todayIso;
  const monthStart = `${input.month}-01`;
  const activeTenancies = tenancies.filter((tenancy) => tenancy.status === 'active');

  return {
    rows,
    tenanciesWithoutCollections: activeTenancies.filter(
      (tenancy) => !rows.some((row) => row.tenancy.id === tenancy.id && row.collection.collectionMonth === input.month)
    ),
    metrics: {
      totalDueThisMonth: rows.reduce((sum, row) => sum + row.total, 0),
      collectedThisMonth,
      outstandingThisMonth,
      overdueAmount: rows.filter((row) => row.status === 'overdue' || row.status === 'partial').reduce((sum, row) => sum + row.outstanding, 0),
      dueToday: rows.filter((row) => row.collection.dueDate === input.todayIso && row.outstanding > 0).length,
      dueWithin3Days: rows.filter((row) => row.collection.dueDate > input.todayIso && row.collection.dueDate <= dueWithin3Iso && row.outstanding > 0).length,
      overdueTenancies: rows.filter((row) => (row.status === 'overdue' || row.status === 'partial') && row.outstanding > 0).length,
      utilityBillsAwaitingUpload: activeTenancies.filter((tenancy) => !accounts.some((account) => account.tenancyId === tenancy.id)).length,
      utilityBillsAwaitingReview: input.utilityBills.filter((bill) => str(bill.review_status) === 'pending_review' || str(bill.review_status) === 'uploaded').length,
      tenanciesMissingUtilityAccounts: activeTenancies.filter((tenancy) => !accounts.some((account) => account.tenancyId === tenancy.id && account.accountStatus === 'active')).length,
      expiring30: activeTenancies.filter((tenancy) => tenancy.expiryDate >= monthStart && tenancy.expiryDate <= addDays(input.todayIso, 30)).length,
      expiring60: activeTenancies.filter((tenancy) => tenancy.expiryDate > addDays(input.todayIso, 30) && tenancy.expiryDate <= addDays(input.todayIso, 60)).length,
      expiring90: activeTenancies.filter((tenancy) => tenancy.expiryDate > addDays(input.todayIso, 60) && tenancy.expiryDate <= addDays(input.todayIso, 90)).length
    }
  };
}

function addDays(isoDate: string, days: number) { return addDaysToIsoDate(isoDate, days) ?? isoDate; }
