import type { TenancyLegalIntelligence } from '../ai/extractTenancy';
import type { TenancyExtraction } from './parser';

export type MappedMoney = number | '';

export type TenancyMappedForm = {
  tenantName: string;
  tenantCompany: string;
  tenantIdentification: string;
  tenantPhone: string;
  tenantEmail: string;
  landlordName: string;
  landlordCompany: string;
  landlordIdentification: string;
  landlordPhone: string;
  landlordEmail: string;
  propertyName: string;
  unitNumber: string;
  fullAddress: string;
  propertyType: string;
  buildUp: string;
  landArea: string;
  carParks: string;
  monthlyRental: MappedMoney;
  securityDeposit: MappedMoney;
  generalUtilityDeposit: MappedMoney;
  accessCardDeposit: MappedMoney;
  carParkRemoteDeposit: MappedMoney;
  stampDuty: MappedMoney;
  commencementDate: string;
  expiryDate: string;
  renewalOption: string;
  noticePeriod: string;
  paymentDueDay: string;
  tnbResponsibility: string;
  waterResponsibility: string;
  iwkResponsibility: string;
  wifiResponsibility: string;
  specialClauses: string;
  witnesses: string;
  inventory: string;
  latePayment: string;
  termination: string;
  viewingRights: string;
  maintenance: string;
  insurance: string;
  signedTa: string;
  renewalReminder: string;
  renewalHistory: string;
  notes: string;
  summary: string;
  risks: unknown[];
  warnings: string[];
  confidence: number;
  fieldConfidence: Record<string, number>;
  sourceReferences: Record<string, unknown>;
  lowConfidenceFields: string[];
  rawAiJson: Record<string, unknown>;
  rawText: string;
  documentId: string;
  workspaceId: string;
};

export const editableTenancyFormFields = [
  'tenantName', 'tenantCompany', 'tenantIdentification', 'tenantPhone', 'tenantEmail',
  'landlordName', 'landlordCompany', 'landlordIdentification', 'landlordPhone', 'landlordEmail',
  'propertyName', 'unitNumber', 'fullAddress', 'propertyType', 'buildUp', 'landArea', 'carParks',
  'monthlyRental', 'securityDeposit', 'generalUtilityDeposit', 'accessCardDeposit',
  'carParkRemoteDeposit', 'stampDuty', 'commencementDate', 'expiryDate', 'renewalOption',
  'noticePeriod', 'paymentDueDay', 'tnbResponsibility', 'waterResponsibility', 'iwkResponsibility',
  'wifiResponsibility', 'specialClauses', 'witnesses', 'inventory', 'latePayment', 'termination',
  'viewingRights', 'maintenance', 'insurance', 'signedTa', 'renewalReminder', 'renewalHistory', 'notes'
] as const satisfies readonly (keyof TenancyMappedForm)[];

export type EditableTenancyFormField = typeof editableTenancyFormFields[number];

type MappingContext = {
  documentId?: string;
  workspaceId?: string;
};

export function mapTenancyExtractionToForm(
  extraction: TenancyExtraction | TenancyLegalIntelligence | Record<string, unknown>,
  context: MappingContext = {}
): TenancyMappedForm {
  const root = record(extraction);
  const legal = record(root.legalIntelligence ?? root.extraction ?? root);
  const fieldConfidence = numericRecord(read(legal, 'field_confidence'));
  const sourceReferences = record(read(legal, 'field_evidence'));
  const monthlyRental = normalizeExtractedMoney(
    read(legal, 'financial.monthly_rental') ?? read(root, 'financial.monthlyRental'),
    '',
    'financial.monthly_rental',
    fieldConfidence,
    sourceReferences
  );
  const summary = text(root.summary);
  const risks = array(read(legal, 'risks'));
  const warnings = array(read(legal, 'warnings')).map(text).filter(Boolean);
  const notes = [
    summary,
    risks.length ? `Risks:\n- ${risks.map(riskSummary).filter(Boolean).join('\n- ')}` : '',
    warnings.length ? `Warnings:\n- ${warnings.join('\n- ')}` : ''
  ].filter(Boolean).join('\n\n');

  const mapped: TenancyMappedForm = {
    tenantName: value(read(legal, 'tenant.name') ?? read(root, 'tenant.name')),
    tenantCompany: value(read(legal, 'tenant.company')),
    tenantIdentification: value(read(legal, 'tenant.ic_passport') ?? read(root, 'tenant.idNo')),
    tenantPhone: normalizeMalaysianPhone(value(read(legal, 'tenant.phone') ?? read(root, 'tenant.phone'))),
    tenantEmail: value(read(legal, 'tenant.email') ?? read(root, 'tenant.email')).toLowerCase(),
    landlordName: value(read(legal, 'landlord.name') ?? read(root, 'landlord.name')),
    landlordCompany: value(read(legal, 'landlord.company')),
    landlordIdentification: value(read(legal, 'landlord.ic_passport') ?? read(root, 'landlord.idNo')),
    landlordPhone: normalizeMalaysianPhone(value(read(legal, 'landlord.phone') ?? read(root, 'landlord.phone'))),
    landlordEmail: value(read(legal, 'landlord.email') ?? read(root, 'landlord.email')).toLowerCase(),
    propertyName: value(read(legal, 'property.name') ?? read(root, 'property.propertyName')),
    unitNumber: value(read(legal, 'property.unit') ?? read(root, 'property.unitNo')),
    fullAddress: value(read(legal, 'property.address') ?? read(root, 'property.fullAddress')),
    propertyType: value(read(legal, 'property.type') ?? read(root, 'property.propertyType')),
    buildUp: value(read(legal, 'property.build_up')),
    landArea: value(read(legal, 'property.land_area')),
    carParks: value(read(legal, 'property.car_parks')),
    monthlyRental,
    securityDeposit: normalizeExtractedMoney(read(legal, 'financial.security_deposit') ?? read(root, 'financial.securityDeposit'), monthlyRental, 'financial.security_deposit', fieldConfidence, sourceReferences),
    generalUtilityDeposit: normalizeExtractedMoney(read(legal, 'financial.utility_deposit') ?? read(root, 'financial.utilityDeposit'), monthlyRental, 'financial.utility_deposit', fieldConfidence, sourceReferences),
    accessCardDeposit: normalizeExtractedMoney(read(legal, 'financial.access_card_deposit') ?? read(root, 'financial.accessCardDeposit'), monthlyRental, 'financial.access_card_deposit', fieldConfidence, sourceReferences),
    carParkRemoteDeposit: normalizeExtractedMoney(read(legal, 'financial.car_park_deposit') ?? read(root, 'financial.carParkRemoteDeposit'), monthlyRental, 'financial.car_park_deposit', fieldConfidence, sourceReferences),
    stampDuty: normalizeExtractedMoney(read(legal, 'financial.stamp_duty'), monthlyRental, 'financial.stamp_duty', fieldConfidence, sourceReferences),
    commencementDate: normalizeDateForInput(value(read(legal, 'tenancy.commencement_date') ?? read(root, 'dates.commencementDate'))),
    expiryDate: normalizeDateForInput(value(read(legal, 'tenancy.expiry_date') ?? read(root, 'dates.expiryDate'))),
    renewalOption: value(read(legal, 'tenancy.renewal_option') ?? read(root, 'dates.renewalOption')),
    noticePeriod: value(read(legal, 'tenancy.notice_period') ?? read(root, 'dates.noticePeriod')),
    paymentDueDay: normalizePaymentDueDay(value(read(legal, 'tenancy.payment_due_day') ?? read(root, 'dates.rentalDueDay'))),
    tnbResponsibility: value(read(legal, 'utilities.tnb')),
    waterResponsibility: value(read(legal, 'utilities.water')),
    iwkResponsibility: value(read(legal, 'utilities.iwk')),
    wifiResponsibility: value(read(legal, 'utilities.wifi')),
    specialClauses: array(read(legal, 'special_clauses')).map(text).filter(Boolean).join('\n\n'),
    witnesses: value(read(legal, 'legal.witnesses')),
    inventory: value(read(legal, 'legal.inventory')),
    latePayment: value(read(legal, 'legal.late_payment')),
    termination: value(read(legal, 'legal.termination')),
    viewingRights: value(read(legal, 'legal.viewing_rights')),
    maintenance: value(read(legal, 'legal.maintenance')),
    insurance: value(read(legal, 'legal.insurance')),
    signedTa: text(read(root, 'document.originalFilename')),
    renewalReminder: normalizeDateForInput(value(read(root, 'dates.renewalReminder'))),
    renewalHistory: value(read(root, 'clauses.renewalClause') ?? read(legal, 'tenancy.renewal_option')),
    notes,
    summary,
    risks,
    warnings,
    confidence: normalizeConfidence(read(legal, 'confidence')),
    fieldConfidence,
    sourceReferences,
    lowConfidenceFields: [],
    rawAiJson: legal,
    rawText: text(root.rawText),
    documentId: context.documentId ?? '',
    workspaceId: context.workspaceId ?? ''
  };

  mapped.lowConfidenceFields = Object.entries(fieldConfidence)
    .filter(([path, confidence]) => confidence < 80 && hasMappedValue(mapped, path))
    .map(([path]) => path);
  if (root.fallbackUsed === true || root.provider === 'deterministic') {
    clearLowConfidenceFallbackValues(mapped, fieldConfidence);
  }
  return mapped;
}

export function mergeMappedFormPreservingEdits(
  current: TenancyMappedForm,
  incoming: TenancyMappedForm,
  editedFields: ReadonlySet<EditableTenancyFormField>
): TenancyMappedForm {
  const retainedEdits = Object.fromEntries(
    Array.from(editedFields, (field) => [field, current[field]])
  ) as Partial<TenancyMappedForm>;
  return { ...incoming, ...retainedEdits };
}

export function normalizeMoney(input: unknown, monthlyRental: MappedMoney = ''): MappedMoney {
  const raw = value(input);
  if (!raw) return '';
  const months = raw.match(/(\d+(?:\.\d+)?)\s*(?:months?|months?'?\s+rent|个月|個月)/i);
  if (months && monthlyRental !== '') return roundMoney(Number(months[1]) * monthlyRental);
  const parsed = Number(raw.replace(/\bMYR\b|RM/gi, '').replace(/[,\s]/g, '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? roundMoney(parsed) : '';
}

function normalizeExtractedMoney(
  input: unknown,
  monthlyRental: MappedMoney,
  path: string,
  fieldConfidence: Record<string, number>,
  sourceReferences: Record<string, unknown>
): MappedMoney {
  const raw = value(input);
  const evidence = record(sourceReferences[path]);
  const evidenceValue = value(evidence.value);
  const confidence = Number(evidence.confidence ?? fieldConfidence[path] ?? 0);
  if (/^0(?:\.0+)?$/.test(raw) && !evidenceValue && (!Number.isFinite(confidence) || confidence <= 0)) return '';
  return normalizeMoney(input, monthlyRental);
}

export function normalizeDateForInput(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return validDate(iso[1], iso[2], iso[3]) ? raw : '';
  const numeric = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (numeric) return validDate(numeric[3], numeric[2], numeric[1])
    ? `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}` : '';
  const named = raw.toLowerCase().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})$/);
  const month = named ? months[named[2]] : undefined;
  return named && month && validDate(named[3], month, named[1])
    ? `${named[3]}-${month}-${named[1].padStart(2, '0')}` : '';
}

export function normalizeMalaysianPhone(input: string): string {
  if (!input.trim()) return '';
  const normalized = input.replace(/[^0-9+]/g, '').replace(/(?!^)\+/g, '');
  if (/^\+60\d{8,10}$/.test(normalized)) return normalized;
  if (/^60\d{8,10}$/.test(normalized)) return `+${normalized}`;
  if (/^0\d{8,10}$/.test(normalized)) return `+60${normalized.slice(1)}`;
  return normalized;
}

function value(input: unknown): string {
  if (input && typeof input === 'object' && 'value' in input) return text((input as { value?: unknown }).value);
  return text(input);
}

function text(input: unknown): string {
  if (input === null || input === undefined) return '';
  return typeof input === 'string' || typeof input === 'number' ? String(input).trim() : '';
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function array(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function read(input: unknown, path: string): unknown {
  let current: unknown = input;
  for (const segment of path.split('.')) current = record(current)[segment];
  return current;
}

function numericRecord(input: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(input)).flatMap(([key, value]) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? [[key, Math.max(0, Math.min(100, parsed))]] : [];
  }));
}

function normalizeConfidence(input: unknown): number {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed)) : 0;
}

function normalizePaymentDueDay(input: string): string {
  const day = Number(input.match(/\d{1,2}/)?.[0]);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? String(day) : '';
}

function riskSummary(input: unknown): string {
  const risk = record(input);
  const reason = text(risk.reason);
  const recommendation = text(risk.recommendation);
  const severity = text(risk.severity).toUpperCase();
  return reason ? `${severity ? `[${severity}] ` : ''}${reason}${recommendation ? ` Recommendation: ${recommendation}` : ''}` : '';
}

function hasMappedValue(mapped: TenancyMappedForm, path: string): boolean {
  const field = formFieldForExtractionPath(path);
  return field ? mapped[field] !== '' : false;
}

function clearLowConfidenceFallbackValues(mapped: TenancyMappedForm, confidence: Record<string, number>): void {
  for (const [path, score] of Object.entries(confidence)) {
    const field = formFieldForExtractionPath(path);
    if (field && score < 80) (mapped as unknown as Record<string, string | number>)[field] = '';
  }
}

function formFieldForExtractionPath(path: string): keyof TenancyMappedForm | undefined {
  const aliases: Record<string, keyof TenancyMappedForm> = {
    'tenant.name': 'tenantName', 'tenant.company': 'tenantCompany', 'tenant.ic_passport': 'tenantIdentification',
    'tenant.phone': 'tenantPhone', 'tenant.email': 'tenantEmail', 'landlord.name': 'landlordName',
    'landlord.company': 'landlordCompany', 'landlord.ic_passport': 'landlordIdentification',
    'landlord.phone': 'landlordPhone', 'landlord.email': 'landlordEmail', 'property.name': 'propertyName',
    'property.unit': 'unitNumber', 'property.address': 'fullAddress', 'property.type': 'propertyType',
    'property.build_up': 'buildUp', 'property.land_area': 'landArea', 'property.car_parks': 'carParks',
    'financial.monthly_rental': 'monthlyRental', 'financial.security_deposit': 'securityDeposit',
    'financial.utility_deposit': 'generalUtilityDeposit', 'financial.access_card_deposit': 'accessCardDeposit',
    'financial.car_park_deposit': 'carParkRemoteDeposit', 'financial.stamp_duty': 'stampDuty',
    'tenancy.commencement_date': 'commencementDate', 'tenancy.expiry_date': 'expiryDate',
    'tenancy.renewal_option': 'renewalOption', 'tenancy.notice_period': 'noticePeriod',
    'tenancy.payment_due_day': 'paymentDueDay', 'utilities.tnb': 'tnbResponsibility',
    'utilities.water': 'waterResponsibility', 'utilities.iwk': 'iwkResponsibility',
    'utilities.wifi': 'wifiResponsibility', 'legal.witnesses': 'witnesses',
    'legal.inventory': 'inventory', 'legal.late_payment': 'latePayment',
    'legal.termination': 'termination', 'legal.viewing_rights': 'viewingRights',
    'legal.insurance': 'insurance', 'legal.maintenance': 'maintenance',
    'special_clauses': 'specialClauses'
  };
  return aliases[path];
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function validDate(year: string, month: string, day: string): boolean {
  const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month) && date.getUTCDate() === Number(day);
}

const months: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
};
