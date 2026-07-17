import { formatMYR } from '../formatters';
import { currentIsoDate, formatNexoraDate, isoMonthToDisplayMonth } from '../dates/formatDate';
import type {
  CollectionPayment,
  CollectionStatus,
  GenerationResult,
  Language,
  SmartCollection,
  TenancySummary,
  UtilityAccount,
  UtilityBillExtraction,
  UtilityProvider
} from './types';

export const notDetected = {
  en: 'Not detected',
  zh: '未检测到'
};

const providerLabels: Record<UtilityProvider, { en: string; zh: string }> = {
  tnb: { en: 'TNB', zh: '电费' },
  water: { en: 'Water', zh: '水费' },
  iwk: { en: 'IWK', zh: 'IWK' },
  wifi: { en: 'WiFi', zh: '网络费' },
  aircond: { en: 'Air-conditioning', zh: '冷气费' },
  other: { en: 'Other utility', zh: '其他水电' }
};

export function formatDisplayDate(isoDate: string) {
  return formatNexoraDate(isoDate);
}

export function formatDisplayMonth(isoMonth: string) {
  return isoMonthToDisplayMonth(isoMonth);
}

export function maskAccountNumber(accountNumber: string) {
  const clean = accountNumber.replace(/\s+/g, '');
  if (clean.length <= 4) return clean ? `***${clean}` : '';
  return `${'*'.repeat(Math.max(clean.length - 4, 3))}${clean.slice(-4)}`;
}

export function collectionTotal(collection: Pick<SmartCollection, 'rentalAmount' | 'tnbAmount' | 'waterAmount' | 'iwkAmount' | 'wifiAmount' | 'aircondAmount' | 'otherCharges' | 'lateCharges' | 'adjustments'>) {
  return Math.max(
    collection.rentalAmount +
      collection.tnbAmount +
      collection.waterAmount +
      collection.iwkAmount +
      collection.wifiAmount +
      collection.aircondAmount +
      collection.otherCharges +
      collection.lateCharges +
      collection.adjustments,
    0
  );
}

export function ledgerAmountPaid(payments: CollectionPayment[]) {
  return payments.reduce((sum, payment) => {
    if (payment.transactionType === 'refund' || payment.transactionType === 'reversal') return sum - payment.amount;
    if (payment.transactionType === 'payment') return sum + payment.amount;
    return sum;
  }, 0);
}

export function outstandingBalance(collection: SmartCollection) {
  return Math.max(collectionTotal(collection) - ledgerAmountPaid(collection.paymentLedger), 0);
}

export function daysBetween(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

export function resolveCollectionStatus(collection: SmartCollection, todayIso: string): CollectionStatus {
  if (collection.status === 'waived' || collection.status === 'disputed') return collection.status;
  const total = collectionTotal(collection);
  const paid = ledgerAmountPaid(collection.paymentLedger);
  const outstanding = Math.max(total - paid, 0);
  if (outstanding === 0) return 'paid';
  if (paid > 0) return 'partial';
  if (collection.dueDate === todayIso) return 'due';
  if (collection.dueDate < todayIso) return 'overdue';
  return 'pending';
}

export function urgencyLevel(collection: SmartCollection, todayIso: string, language: Exclude<Language, 'bilingual'> = 'en') {
  const daysOverdue = daysBetween(collection.dueDate, todayIso);
  const outstanding = outstandingBalance(collection);
  const zh = language === 'zh';
  if (outstanding <= 0 || collection.status === 'waived' || collection.status === 'disputed') return zh ? '已处理' : 'Settled';
  if (daysOverdue < 0 && daysOverdue >= -3) return zh ? '即将到期' : 'Due soon';
  if (daysOverdue === 0) return zh ? '今日到期' : 'Due today';
  if (daysOverdue <= 3) return zh ? '逾期 1-3 天' : '1-3 days overdue';
  if (daysOverdue <= 7) return zh ? '逾期 4-7 天' : '4-7 days overdue';
  if (daysOverdue <= 14) return zh ? '逾期 8-14 天' : '8-14 days overdue';
  return zh ? '逾期超过 14 天' : 'More than 14 days overdue';
}

export function detectProvider(text: string): UtilityProvider | 'not_detected' {
  const lower = text.toLowerCase();
  if (lower.includes('tenaga') || /\btnb\b/i.test(text)) return 'tnb';
  if (lower.includes('air selangor') || lower.includes('water')) return 'water';
  if (/\biwk\b/i.test(text) || lower.includes('indah water')) return 'iwk';
  if (lower.includes('unifi') || lower.includes('maxis') || lower.includes('time internet') || lower.includes('wifi')) return 'wifi';
  if (lower.includes('air-conditioning') || lower.includes('aircond')) return 'aircond';
  return 'not_detected';
}

function numberAfter(pattern: RegExp, text: string) {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const number = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

export function extractUtilityBill(rawText: string, sourceFilename: string): UtilityBillExtraction {
  const provider = detectProvider(rawText);
  const accountNumber = rawText.match(/(?:account|acct|no akaun|a\/c)\s*(?:no\.?|number)?\s*:?\s*([A-Z0-9-]{6,})/i)?.[1] ?? '';
  const dueDate = rawText.match(/(?:due date|tarikh akhir|pay before)\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)?.[1] ?? '';
  const billDate = rawText.match(/(?:bill date|tarikh bil)\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)?.[1] ?? '';
  const totalAmountDue = numberAfter(/(?:total amount due|jumlah perlu dibayar|amount due)\s*:?\s*RM?\s*([0-9,.]+)/i, rawText);
  const detectedValues = [provider !== 'not_detected', accountNumber, dueDate, billDate, totalAmountDue !== null].filter(Boolean).length;

  return {
    provider,
    accountNumber,
    meterNumber: rawText.match(/(?:meter no\.?|meter number|no meter)\s*:?\s*([A-Z0-9-]{4,})/i)?.[1] ?? '',
    registeredName: rawText.match(/(?:name|nama)\s*:?\s*([A-Z][A-Z\s'.-]{4,})/i)?.[1]?.trim() ?? '',
    serviceAddress: rawText.match(/(?:address|alamat)\s*:?\s*([^\n]{10,})/i)?.[1]?.trim() ?? '',
    billNumber: rawText.match(/(?:bill no\.?|invoice no\.?|no bil)\s*:?\s*([A-Z0-9-]{4,})/i)?.[1] ?? '',
    billDate,
    billingPeriod: rawText.match(/(?:billing period|tempoh bil)\s*:?\s*([^\n]{5,})/i)?.[1]?.trim() ?? '',
    dueDate,
    previousBalance: numberAfter(/(?:previous balance|baki terdahulu)\s*:?\s*RM?\s*([0-9,.]+)/i, rawText),
    currentCharges: numberAfter(/(?:current charges|caj semasa)\s*:?\s*RM?\s*([0-9,.]+)/i, rawText),
    adjustments: numberAfter(/(?:adjustments?|pelarasan)\s*:?\s*RM?\s*([0-9,.-]+)/i, rawText),
    tax: numberAfter(/(?:tax|sst|cukai)\s*:?\s*RM?\s*([0-9,.]+)/i, rawText),
    totalAmountDue,
    paymentStatus: rawText.match(/paid|unpaid|overdue|tertunggak/i)?.[0] ?? '',
    referenceNumber: rawText.match(/(?:reference|rujukan)\s*:?\s*([A-Z0-9-]{4,})/i)?.[1] ?? '',
    rawText,
    confidence: detectedValues >= 4 ? 'high' : detectedValues >= 2 ? 'medium' : detectedValues > 0 ? 'low' : 'not_detected',
    sourceFilename
  };
}

export function matchUtilityAccount(accounts: UtilityAccount[], extraction: UtilityBillExtraction) {
  if (!extraction.accountNumber) return null;
  return accounts.find((account) => account.accountNumber.replace(/\s+/g, '') === extraction.accountNumber.replace(/\s+/g, '')) ?? null;
}

export function generateMonthlyCollections(tenancies: TenancySummary[], existing: SmartCollection[], targetMonth: string, todayIso: string): GenerationResult {
  const result: GenerationResult = { success: true, created: [], skipped: [], failed: [] };

  tenancies.forEach((tenancy) => {
    if (tenancy.status !== 'active') {
      result.skipped.push({ tenancyId: tenancy.id, reason: 'inactive-tenancy' });
      return;
    }
    if (!tenancy.autoGenerateCollections) {
      result.skipped.push({ tenancyId: tenancy.id, reason: 'auto-generation-disabled' });
      return;
    }
    if (tenancy.collectionStartMonth && targetMonth < tenancy.collectionStartMonth) {
      result.skipped.push({ tenancyId: tenancy.id, reason: 'before-start-month' });
      return;
    }
    if ((tenancy.collectionEndMonth && targetMonth > tenancy.collectionEndMonth) || `${targetMonth}-01` > tenancy.expiryDate) {
      result.skipped.push({ tenancyId: tenancy.id, reason: 'after-expiry' });
      return;
    }
    if (existing.some((collection) => collection.tenancyId === tenancy.id && collection.collectionMonth === targetMonth)) {
      result.skipped.push({ tenancyId: tenancy.id, reason: 'duplicate-month' });
      return;
    }
    if (targetMonth < todayIso.slice(0, 7) && !tenancy.collectionStartMonth) {
      result.failed.push({ tenancyId: tenancy.id, reason: 'missing-start-month' });
      result.success = false;
      return;
    }
    result.created.push({ tenancyId: tenancy.id, collectionMonth: targetMonth });
  });

  return result;
}

function utilityLines(accounts: UtilityAccount[], language: Language) {
  const localized = language === 'zh' ? 'zh' : 'en';
  return accounts.length
    ? accounts.map((account) => `${providerLabels[account.provider][localized]}: ${account.accountNumberMasked || maskAccountNumber(account.accountNumber)}`).join('\n')
    : language === 'zh' ? notDetected.zh : notDetected.en;
}

export function renderTenantReminder(input: {
  tenant: TenancySummary;
  collection: SmartCollection;
  accounts: UtilityAccount[];
  language: Language;
  agentName: string;
}) {
  const english = `Hello ${input.tenant.tenant},

This is a friendly reminder for the payment due for ${formatDisplayMonth(input.collection.collectionMonth)}.

Rental: ${formatMYR(input.collection.rentalAmount)}
TNB: ${formatMYR(input.collection.tnbAmount)}
Water: ${formatMYR(input.collection.waterAmount)}
IWK: ${formatMYR(input.collection.iwkAmount)}
WiFi: ${formatMYR(input.collection.wifiAmount)}
Other charges: ${formatMYR(input.collection.otherCharges + input.collection.aircondAmount + input.collection.lateCharges + input.collection.adjustments)}
Total due: ${formatMYR(collectionTotal(input.collection))}
Amount paid: ${formatMYR(ledgerAmountPaid(input.collection.paymentLedger))}
Outstanding: ${formatMYR(outstandingBalance(input.collection))}
Due date: ${formatDisplayDate(input.collection.dueDate)}

Utility account references:
${utilityLines(input.accounts, 'en')}

Kindly ignore this reminder if payment has already been made. Thank you.

${input.agentName}`;

  const chinese = `您好 ${input.tenant.tenant}，

温馨提醒您支付 ${formatDisplayMonth(input.collection.collectionMonth)} 的款项。

租金：${formatMYR(input.collection.rentalAmount)}
电费：${formatMYR(input.collection.tnbAmount)}
水费：${formatMYR(input.collection.waterAmount)}
IWK：${formatMYR(input.collection.iwkAmount)}
网络费：${formatMYR(input.collection.wifiAmount)}
其他费用：${formatMYR(input.collection.otherCharges + input.collection.aircondAmount + input.collection.lateCharges + input.collection.adjustments)}
应付总额：${formatMYR(collectionTotal(input.collection))}
已付款：${formatMYR(ledgerAmountPaid(input.collection.paymentLedger))}
未结余额：${formatMYR(outstandingBalance(input.collection))}
到期日：${formatDisplayDate(input.collection.dueDate)}

水电账户资料：
${utilityLines(input.accounts, 'zh')}

若您已经付款，请忽略此提醒。谢谢。

${input.agentName}`;

  if (input.language === 'zh') return chinese;
  if (input.language === 'bilingual') return `${english}\n\n---\n\n${chinese}`;
  return english;
}

export function renderLandlordUpdate(input: { tenant: TenancySummary; collection: SmartCollection; pendingUtilityBills: number; nextFollowUpDate: string; language: Language }) {
  const english = `Collection update for ${input.tenant.property} ${input.tenant.unitNo}

Status: ${resolveCollectionStatus(input.collection, currentIsoDate())}
Total received: ${formatMYR(ledgerAmountPaid(input.collection.paymentLedger))}
Outstanding: ${formatMYR(outstandingBalance(input.collection))}
Utility bills pending: ${input.pendingUtilityBills}
Tenant reminder count: ${input.collection.reminderCount}
Last payment date: ${input.collection.paymentLedger[0]?.paymentDate ? formatDisplayDate(input.collection.paymentLedger[0].paymentDate) : notDetected.en}
Next follow-up: ${formatDisplayDate(input.nextFollowUpDate)}
Notes: ${input.collection.notes || notDetected.en}`;

  const chinese = `${input.tenant.property} ${input.tenant.unitNo} 收款更新

状态：${resolveCollectionStatus(input.collection, currentIsoDate())}
已收款：${formatMYR(ledgerAmountPaid(input.collection.paymentLedger))}
未结余额：${formatMYR(outstandingBalance(input.collection))}
待处理水电账单：${input.pendingUtilityBills}
租客提醒次数：${input.collection.reminderCount}
最后付款日期：${input.collection.paymentLedger[0]?.paymentDate ? formatDisplayDate(input.collection.paymentLedger[0].paymentDate) : notDetected.zh}
下次跟进：${formatDisplayDate(input.nextFollowUpDate)}
备注：${input.collection.notes || notDetected.zh}`;

  if (input.language === 'zh') return chinese;
  if (input.language === 'bilingual') return `${english}\n\n---\n\n${chinese}`;
  return english;
}
