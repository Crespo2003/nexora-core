import { displayDateToIso } from '../dates/formatDate';
import type { TenancyExtraction } from '../ai/tenancyExtractor';
import type { CollectionRecord, DocumentRecord, TenancyRecord, UtilityAccountRecord, WorkspaceWarning } from './types';

type ExtractedField = { value?: string; confidence?: string };

const tenancyFieldMap: Array<[keyof TenancyRecord, (value: TenancyExtraction) => ExtractedField | undefined, 'money' | 'integer' | 'date' | 'text']> = [
  ['property', (value) => value.property.propertyName, 'text'],
  ['unit_no', (value) => value.property.unitNo, 'text'],
  ['property_address', (value) => value.property.fullAddress, 'text'],
  ['property_type', (value) => value.property.propertyType, 'text'],
  ['landlord', (value) => value.landlord.name, 'text'],
  ['landlord_id_no', (value) => value.landlord.idNo, 'text'],
  ['landlord_phone', (value) => value.landlord.phone, 'text'],
  ['landlord_email', (value) => value.landlord.email, 'text'],
  ['tenant', (value) => value.tenant.name, 'text'],
  ['tenant_id_no', (value) => value.tenant.idNo, 'text'],
  ['tenant_phone', (value) => value.tenant.phone, 'text'],
  ['tenant_email', (value) => value.tenant.email, 'text'],
  ['monthly_rental', (value) => value.financial.monthlyRental, 'money'],
  ['security_deposit', (value) => value.financial.securityDeposit, 'money'],
  ['utility_deposit', (value) => value.financial.utilityDeposit, 'money'],
  ['access_card_deposit', (value) => value.financial.accessCardDeposit, 'money'],
  ['car_park_remote_deposit', (value) => value.financial.carParkRemoteDeposit, 'money'],
  ['commencement_date', (value) => value.dates.commencementDate, 'date'],
  ['expiry_date', (value) => value.dates.expiryDate, 'date'],
  ['rental_due_day', (value) => value.dates.rentalDueDay, 'integer'],
  ['renewal_option', (value) => value.dates.renewalOption, 'text'],
  ['notice_period', (value) => value.dates.noticePeriod, 'text'],
  ['special_clauses', (value) => value.clauses.specialClauses, 'text']
];

export function tenancyChangesFromExtraction(extraction: TenancyExtraction, includeLowConfidence = false) {
  const changes: Record<string, string | number> = {};
  const lowConfidenceFields: string[] = [];

  for (const [target, read, kind] of tenancyFieldMap) {
    const field = read(extraction);
    if (!field?.value) continue;
    if (field.confidence === 'low' && !includeLowConfidence) {
      lowConfidenceFields.push(String(target));
      continue;
    }
    if (kind === 'money' || kind === 'integer') {
      const amount = Number(String(field.value).replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(amount) && amount >= 0 && (kind !== 'integer' || (amount >= 1 && amount <= 31))) changes[String(target)] = amount;
    } else if (kind === 'date') {
      const date = displayDateToIso(String(field.value));
      if (date) changes[String(target)] = date;
      else lowConfidenceFields.push(String(target));
    } else {
      changes[String(target)] = String(field.value).trim();
    }
  }

  return { changes, lowConfidenceFields };
}

export function paymentLedgerTotals(payments: Array<{ amount: number | string; transaction_type: string }>, totalDue: number) {
  const paid = payments.reduce((sum, payment) => {
    const amount = Math.max(Number(payment.amount ?? 0), 0);
    if (payment.transaction_type === 'refund' || payment.transaction_type === 'reversal') return sum - amount;
    if (payment.transaction_type === 'payment' || payment.transaction_type === 'advance_payment') return sum + amount;
    return sum;
  }, 0);
  const amountPaid = Math.max(paid, 0);
  return {
    amountPaid,
    outstanding: Math.max(totalDue - amountPaid, 0),
    credit: Math.max(amountPaid - totalDue, 0)
  };
}

export function buildWorkspaceWarnings(input: {
  tenancy: TenancyRecord;
  collections: CollectionRecord[];
  utilityAccounts: UtilityAccountRecord[];
  utilityBills: Array<Record<string, unknown>>;
  documents: DocumentRecord[];
  today?: Date;
}) {
  const { tenancy, collections, utilityAccounts, utilityBills, documents } = input;
  const today = input.today ?? new Date();
  const warnings: WorkspaceWarning[] = [];
  const daysUntil = (value?: string | null) => value ? Math.ceil((Date.parse(`${value.slice(0, 10)}T00:00:00Z`) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000) : null;
  const tenancyDays = daysUntil(tenancy.expiry_date);
  if (tenancyDays !== null && tenancyDays >= 0 && tenancyDays <= 90) warnings.push({ code: 'tenancy-expiring', severity: 'warning', message: `Tenancy expires in ${tenancyDays} days.` });
  const outstanding = collections.reduce((sum, item) => sum + Number(item.outstanding_balance ?? 0), 0);
  if (outstanding > 0) warnings.push({ code: 'outstanding-rental', severity: 'danger', message: `Outstanding collections total MYR ${outstanding.toFixed(2)}.` });
  if (!utilityAccounts.length) warnings.push({ code: 'missing-utility-account', severity: 'warning', message: 'No utility account is linked to this tenancy.' });

  const currentMonth = today.toISOString().slice(0, 7);
  for (const account of utilityAccounts) {
    const hasCurrentBill = utilityBills.some((bill) => String(bill.provider) === account.provider && String(bill.bill_date ?? bill.due_date ?? '').startsWith(currentMonth));
    if (!hasCurrentBill) warnings.push({ code: `missing-bill-${account.provider}`, severity: 'info', message: `${account.provider.toUpperCase()} bill is missing for ${currentMonth}.` });
    const providerBills = utilityBills.filter((bill) => String(bill.provider) === account.provider).sort((a, b) => String(b.bill_date ?? b.created_at).localeCompare(String(a.bill_date ?? a.created_at)));
    if (providerBills.length > 1) {
      const latest = Number(providerBills[0].total_amount_due ?? 0);
      const previous = Number(providerBills[1].total_amount_due ?? 0);
      if (previous > 0 && latest > previous * 1.3) warnings.push({ code: `large-bill-${account.provider}`, severity: 'danger', message: `${account.provider.toUpperCase()} bill increased by ${Math.round(((latest - previous) / previous) * 100)}%.` });
    }
  }

  if (documents.some((document) => document.processing_status === 'duplicate')) warnings.push({ code: 'duplicate-document', severity: 'warning', message: 'A duplicate document needs review.' });
  const identityDays = daysUntil(tenancy.tenant_identity_expiry);
  if (identityDays !== null && identityDays < 0) warnings.push({ code: 'expired-passport', severity: 'danger', message: 'Tenant passport or identity document has expired.' });
  const insuranceDays = daysUntil(tenancy.insurance_expiry);
  if (insuranceDays !== null && insuranceDays < 0) warnings.push({ code: 'expired-insurance', severity: 'danger', message: 'Property insurance has expired.' });
  return warnings;
}
