import type { OcrProvider } from '../ocr/ocrProvider';
import { extractDocumentText } from '../documents/extractText';
import { OpenAiClientError, requestStructuredOpenAi } from './openAiClient';

export type LegalParty = {
  name: string;
  company: string;
  ic_passport: string;
  phone: string;
  email: string;
};

export type LegalRiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export type LegalRisk = {
  code: string;
  severity: LegalRiskSeverity;
  reason: string;
  recommendation: string;
};

export type FieldConfidence = Record<string, number>;

export type TenancyLegalIntelligence = {
  document_type: string;
  confidence: number;
  tenant: LegalParty;
  landlord: LegalParty;
  property: {
    name: string;
    unit: string;
    address: string;
    type: string;
    build_up: string;
    land_area: string;
    car_parks: string;
  };
  financial: {
    monthly_rental: number;
    security_deposit: number;
    utility_deposit: number;
    access_card_deposit: number;
    car_park_deposit: number;
    stamp_duty: number;
  };
  tenancy: {
    commencement_date: string;
    expiry_date: string;
    renewal_option: string;
    notice_period: string;
    payment_due_day: string;
  };
  utilities: {
    tnb: string;
    water: string;
    iwk: string;
    wifi: string;
  };
  legal: {
    signatures: string;
    witnesses: string;
    stamp_duty: string;
    inventory: string;
    restrictions: string[];
    late_payment: string;
    termination: string;
    viewing_rights: string;
    insurance: string;
    maintenance: string;
    access_card: string;
    car_park: string;
  };
  special_clauses: string[];
  risks: LegalRisk[];
  warnings: string[];
  field_confidence: FieldConfidence;
};

export type TenancyDocumentInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

export type TenancyProcessingResult = {
  extraction: TenancyLegalIntelligence;
  rawText: string;
  summary: string;
  pageCount: number | null;
  usedOcr: boolean;
  chunkCount: number;
  model: string;
};

type ExtractTenancyOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  ocrProvider?: OcrProvider;
  maxChunkCharacters?: number;
};

const stringSchema = { type: 'string' } as const;
const confidencePaths = [
  'document_type', 'tenant.name', 'tenant.company', 'tenant.ic_passport', 'tenant.phone', 'tenant.email',
  'landlord.name', 'landlord.company', 'landlord.ic_passport', 'landlord.phone', 'landlord.email',
  'property.name', 'property.unit', 'property.address', 'property.type', 'property.build_up', 'property.land_area', 'property.car_parks',
  'financial.monthly_rental', 'financial.security_deposit', 'financial.utility_deposit', 'financial.access_card_deposit', 'financial.car_park_deposit', 'financial.stamp_duty',
  'tenancy.commencement_date', 'tenancy.expiry_date', 'tenancy.renewal_option', 'tenancy.notice_period', 'tenancy.payment_due_day',
  'utilities.tnb', 'utilities.water', 'utilities.iwk', 'utilities.wifi',
  'legal.signatures', 'legal.witnesses', 'legal.stamp_duty', 'legal.inventory', 'legal.restrictions', 'legal.late_payment',
  'legal.termination', 'legal.viewing_rights', 'legal.insurance', 'legal.maintenance', 'legal.access_card', 'legal.car_park',
  'special_clauses'
] as const;
const partySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'company', 'ic_passport', 'phone', 'email'],
  properties: {
    name: stringSchema,
    company: stringSchema,
    ic_passport: stringSchema,
    phone: stringSchema,
    email: stringSchema
  }
} as const;
const legalRiskSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'severity', 'reason', 'recommendation'],
  properties: {
    code: stringSchema,
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    reason: stringSchema,
    recommendation: stringSchema
  }
} as const;

export const tenancyLegalIntelligenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'document_type', 'confidence', 'tenant', 'landlord', 'property', 'financial',
    'tenancy', 'utilities', 'legal', 'special_clauses', 'risks', 'warnings', 'field_confidence'
  ],
  properties: {
    document_type: stringSchema,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    tenant: partySchema,
    landlord: partySchema,
    property: {
      type: 'object', additionalProperties: false,
      required: ['name', 'unit', 'address', 'type', 'build_up', 'land_area', 'car_parks'],
      properties: {
        name: stringSchema, unit: stringSchema, address: stringSchema, type: stringSchema,
        build_up: stringSchema, land_area: stringSchema, car_parks: stringSchema
      }
    },
    financial: {
      type: 'object', additionalProperties: false,
      required: ['monthly_rental', 'security_deposit', 'utility_deposit', 'access_card_deposit', 'car_park_deposit', 'stamp_duty'],
      properties: {
        monthly_rental: { type: 'number', minimum: 0 },
        security_deposit: { type: 'number', minimum: 0 },
        utility_deposit: { type: 'number', minimum: 0 },
        access_card_deposit: { type: 'number', minimum: 0 },
        car_park_deposit: { type: 'number', minimum: 0 },
        stamp_duty: { type: 'number', minimum: 0 }
      }
    },
    tenancy: {
      type: 'object', additionalProperties: false,
      required: ['commencement_date', 'expiry_date', 'renewal_option', 'notice_period', 'payment_due_day'],
      properties: {
        commencement_date: stringSchema, expiry_date: stringSchema, renewal_option: stringSchema,
        notice_period: stringSchema, payment_due_day: stringSchema
      }
    },
    utilities: {
      type: 'object', additionalProperties: false,
      required: ['tnb', 'water', 'iwk', 'wifi'],
      properties: { tnb: stringSchema, water: stringSchema, iwk: stringSchema, wifi: stringSchema }
    },
    legal: {
      type: 'object', additionalProperties: false,
      required: ['signatures', 'witnesses', 'stamp_duty', 'inventory', 'restrictions', 'late_payment', 'termination', 'viewing_rights', 'insurance', 'maintenance', 'access_card', 'car_park'],
      properties: {
        signatures: stringSchema, witnesses: stringSchema, stamp_duty: stringSchema,
        inventory: stringSchema, restrictions: { type: 'array', items: stringSchema },
        late_payment: stringSchema, termination: stringSchema, viewing_rights: stringSchema,
        insurance: stringSchema, maintenance: stringSchema, access_card: stringSchema, car_park: stringSchema
      }
    },
    special_clauses: { type: 'array', items: stringSchema },
    risks: { type: 'array', items: legalRiskSchema },
    warnings: { type: 'array', items: stringSchema },
    field_confidence: {
      type: 'object',
      description: 'Confidence percentage from 0 to 100 for every scalar or array field, keyed by dot path.',
      additionalProperties: false,
      required: confidencePaths,
      properties: Object.fromEntries(confidencePaths.map((path) => [path, { type: 'number', minimum: 0, maximum: 100 }]))
    }
  }
} as const;

const extractionInstructions = `You are Nexora AI Legal Intelligence, a specialist in Malaysian tenancy agreements.
Read every supplied word. Extract facts only from the agreement; never infer identity, contact, property, money, or legal terms that are absent.
Understand English, Simplified or Traditional Chinese, Bahasa Malaysia, and mixed-language Malaysian agreements.
Classify the premises as Residential, Commercial, Industrial, Office, Retail, Bungalow, Embassy, Factory, Warehouse, Shoplot, or the most precise stated type.
Normalize all Malaysian Ringgit values to plain non-negative numbers with no RM symbol or commas.
Normalize complete dates to YYYY-MM-DD. Keep an empty string when a date is absent or ambiguous.
Use empty strings, zero, and empty arrays for facts that are not stated.
Preserve material special clauses as concise complete statements.
Extract signatures, witnesses, stamp duty, inventory, restrictions, late-payment terms, termination, viewing rights, insurance, maintenance, access-card and car-park terms.
Identify legal and operational risks, including missing signatures, missing witnesses, missing party IC/passport details, missing stamp duty evidence, conflicting rental amounts or dates, potentially unlawful or unenforceable clauses, no renewal clause, no inspection clause, no termination clause, deposit mismatch, missing inventory, and missing maintenance terms.
Every risk must include a stable snake_case code, severity, evidence-based reason, and practical recommendation.
Populate field_confidence with a 0-100 percentage for every extracted scalar and array field using its dot path, for example tenant.name, financial.monthly_rental, legal.witnesses and special_clauses. Use 0 for absent fields.
Do not provide legal conclusions as certain when the text only supports a concern; label those items as requiring legal review.
Confidence is a number from 0 to 1 representing the reliability and completeness of the entire extraction.
Return only the requested JSON schema.`;

export class TenancyExtractionError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = 'TenancyExtractionError';
  }
}

export async function extractTenancy(
  input: TenancyDocumentInput,
  options: ExtractTenancyOptions = {}
): Promise<TenancyLegalIntelligence> {
  return (await extractTenancyDocument(input, options)).extraction;
}

export async function extractTenancyDocument(
  input: TenancyDocumentInput,
  options: ExtractTenancyOptions = {}
): Promise<TenancyProcessingResult> {
  const textResult = await extractDocumentText(input, options.ocrProvider);
  if (textResult.status !== 'completed' || !textResult.text.trim()) {
    throw new TenancyExtractionError(textResult.error || 'document-text-extraction-failed');
  }

  const result = await extractTenancyText(textResult.text, input.filename, options);
  return {
    ...result,
    pageCount: textResult.pageCount,
    usedOcr: textResult.usedOcr
  };
}

export async function extractTenancyText(
  rawText: string,
  filename: string,
  options: ExtractTenancyOptions = {}
): Promise<Omit<TenancyProcessingResult, 'pageCount' | 'usedOcr'>> {
  const normalizedText = normalizeDocumentText(rawText);
  if (normalizedText.length < 80) throw new TenancyExtractionError('insufficient-document-text');

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new TenancyExtractionError('openai-not-configured');

  const model = options.model ?? process.env.OPENAI_TENANCY_MODEL ?? 'gpt-5.5';
  const chunks = splitTenancyDocument(normalizedText, options.maxChunkCharacters);
  const partials: TenancyLegalIntelligence[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    partials.push(await requestStructuredExtraction({
      apiKey,
      model,
      fetcher: options.fetcher,
      prompt: `Document: ${filename}\nSection ${index + 1} of ${chunks.length}. Extract every relevant fact from this section.\n\n${chunks[index]}`
    }));
  }

  const reconciled = partials.length === 1
    ? partials[0]
    : await requestStructuredExtraction({
      apiKey,
      model,
      fetcher: options.fetcher,
      prompt: `Reconcile these ordered section extractions from one Malaysian tenancy agreement. Resolve conflicts using repeated agreement evidence, retain facts found in any section, and return one complete record.\n\n${JSON.stringify(partials)}`
    });
  const normalized = normalizeExtraction(reconciled);
  const extraction = applyRiskEngine(normalized, normalizedText);

  return {
    extraction,
    rawText: normalizedText,
    summary: createTenancySummary(extraction),
    chunkCount: chunks.length,
    model
  };
}

export function splitTenancyDocument(rawText: string, maximumCharacters = 48_000): string[] {
  const text = normalizeDocumentText(rawText);
  const max = Math.max(8_000, maximumCharacters);
  if (text.length <= max) return [text];

  const paragraphs = text.split(/\n{2,}/).flatMap((paragraph) => splitOversizedParagraph(paragraph, max));
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    const overlap = current.slice(-1_200);
    current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function applyRiskEngine(
  source: TenancyLegalIntelligence,
  rawText: string
): TenancyLegalIntelligence {
  const extraction = normalizeExtraction(source);
  const text = rawText.toLowerCase();
  const risks = [...extraction.risks];
  const warnings = [...extraction.warnings];

  if (!/\bsignature(?:s|d)?\b|signed by|execution|ditandatangani/.test(text)) addRisk(risks, 'missing_signatures', 'high', 'No signature or execution wording was detected.', 'Confirm that every required party has signed the final agreement.');
  if (!/\bwitness(?:es|ed)?\b|in the presence of|saksi/.test(text)) addRisk(risks, 'missing_witness', 'high', 'No witness or witnessing provision was detected.', 'Arrange witnessing and record each witness name and signature where required.');
  if (!/stamp duty|stamping|duly stamped|hasil|lhdn|setem/.test(text) && extraction.financial.stamp_duty === 0) {
    addRisk(risks, 'missing_stamp_duty', 'high', 'No stamp duty amount or evidence of stamping was detected.', 'Verify assessment and stamping with LHDN before relying on the agreement.');
  }
  if (!/renew|renewal|pembaharuan/.test(text) && !extraction.tenancy.renewal_option) addRisk(risks, 'missing_renewal_clause', 'medium', 'No renewal option or renewal clause was detected.', 'Confirm whether renewal is intentionally excluded or document the agreed renewal process.');
  if (!/inspect|inspection|viewing|memeriksa|pemeriksaan/.test(text)) addRisk(risks, 'missing_inspection_clause', 'medium', 'No inspection or viewing clause was detected.', 'Add reasonable notice, access, and inspection conditions.');
  if (!/terminat|termination|determin|penamatan/.test(text)) addRisk(risks, 'missing_termination_clause', 'high', 'No termination clause was detected.', 'Add clear termination events, notice periods, remedies, and handover obligations.');
  if (!extraction.landlord.ic_passport) addRisk(risks, 'missing_landlord_ic', 'high', 'The landlord IC, passport, or company registration number is missing.', 'Verify and record the landlord identity before execution.');
  if (!extraction.tenant.ic_passport) addRisk(risks, 'missing_tenant_ic', 'high', 'The tenant IC, passport, or company registration number is missing.', 'Verify and record the tenant identity before execution.');
  if (!hasPartyDetails(extraction.landlord)) addRisk(risks, 'missing_landlord_details', 'high', 'Material landlord identity or contact details are missing.', 'Complete and verify the landlord particulars.');
  if (!hasPartyDetails(extraction.tenant)) addRisk(risks, 'missing_tenant_details', 'high', 'Material tenant identity or contact details are missing.', 'Complete and verify the tenant particulars.');
  if (!/inventory|schedule of contents|fixtures and fittings|senarai inventori/.test(text)) addRisk(risks, 'missing_inventory', 'medium', 'No inventory or schedule of contents was detected.', 'Attach a signed inventory with condition evidence for furnished premises.');
  if (!/maintain|maintenance|repair|upkeep|penyelenggaraan|pembaikan/.test(text)) addRisk(risks, 'missing_maintenance_clause', 'medium', 'No maintenance or repair allocation was detected.', 'Define landlord and tenant maintenance responsibilities and approval thresholds.');

  const rentalValues = extractRentalAmounts(rawText);
  if (new Set(rentalValues.map((value) => value.toFixed(2))).size > 1) addRisk(risks, 'rental_inconsistency', 'high', 'Conflicting monthly rental amounts were detected.', 'Verify the operative rental amount across the body, schedules, and payment clauses.');

  const expectedSecurityMonths = extractDepositMonths(rawText, 'security');
  if (expectedSecurityMonths !== null && extraction.financial.monthly_rental > 0) {
    const expected = extraction.financial.monthly_rental * expectedSecurityMonths;
    if (Math.abs(expected - extraction.financial.security_deposit) > 1) addRisk(risks, 'security_deposit_mismatch', 'high', 'The security deposit amount does not match the stated rental-month multiple.', 'Reconcile the stated multiple and payable amount before signing.');
  }
  const expectedUtilityMonths = extractDepositMonths(rawText, 'utilit');
  if (expectedUtilityMonths !== null && extraction.financial.monthly_rental > 0) {
    const expected = extraction.financial.monthly_rental * expectedUtilityMonths;
    if (Math.abs(expected - extraction.financial.utility_deposit) > 1) addRisk(risks, 'utility_deposit_mismatch', 'high', 'The utility deposit amount does not match the stated rental-month multiple.', 'Reconcile the stated multiple and payable amount before signing.');
  }

  if (/evict.{0,80}without (?:a )?court|enter.{0,80}without (?:prior )?notice|forfeit.{0,80}without notice|waive.{0,80}(?:legal|statutory) rights?/.test(text)) {
    addRisk(risks, 'potentially_illegal_clause', 'critical', 'A potentially unlawful or unenforceable clause may permit self-help eviction, unannounced entry, automatic forfeiture, or waiver of statutory rights.', 'Obtain Malaysian legal advice and revise the clause before relying on it.');
  }
  if (hasConflictingDates(extraction, rawText)) addRisk(risks, 'conflicting_dates', 'high', 'Conflicting or chronologically invalid tenancy dates were detected.', 'Reconcile commencement, term, and expiry dates throughout the agreement.');
  if (!extraction.tenancy.commencement_date) warnings.push('Commencement date was not reliably detected.');
  if (!extraction.tenancy.expiry_date) warnings.push('Expiry date was not reliably detected.');
  if (extraction.confidence < 0.75) warnings.push('Overall extraction confidence is below 75%; verify against the source document.');

  return { ...extraction, risks: uniqueRisks(risks), warnings: uniqueStrings(warnings) };
}

export function createTenancySummary(extraction: TenancyLegalIntelligence): string {
  const type = extraction.property.type || extraction.document_type || 'tenancy';
  const commencement = formatSummaryDate(extraction.tenancy.commencement_date);
  const duration = tenancyDuration(extraction.tenancy.commencement_date, extraction.tenancy.expiry_date);
  const opening = `This is a ${duration ? `${duration} ` : ''}${type.toLowerCase()} tenancy${commencement ? ` commencing on ${commencement}` : ''}`;
  const money = extraction.financial;
  const amounts = [
    money.monthly_rental > 0 ? `RM${formatMoney(money.monthly_rental)} monthly rental` : '',
    money.security_deposit > 0 ? `RM${formatMoney(money.security_deposit)} security deposit` : '',
    money.utility_deposit > 0 ? `RM${formatMoney(money.utility_deposit)} utility deposit` : ''
  ].filter(Boolean);
  const renewal = extraction.tenancy.renewal_option ? ' Renewal option available.' : ' No renewal option was detected.';
  const risk = ` ${extraction.risks.length} legal ${extraction.risks.length === 1 ? 'risk' : 'risks'} detected.`;
  return `${opening}${amounts.length ? ` with ${amounts.join(', ')}` : ''}.${renewal}${risk}`.replace(/\s+/g, ' ').trim();
}

async function requestStructuredExtraction(input: {
  apiKey: string;
  model: string;
  prompt: string;
  fetcher?: typeof fetch;
}): Promise<TenancyLegalIntelligence> {
  try {
    return await requestStructuredOpenAi({
      apiKey: input.apiKey,
      model: input.model,
      fetcher: input.fetcher,
      schemaName: 'malaysian_tenancy_legal_intelligence',
      schema: tenancyLegalIntelligenceSchema,
      system: extractionInstructions,
      prompt: input.prompt,
      maxOutputTokens: 12_000,
      maxAttempts: 3,
      validate: validateExtractionShape
    });
  } catch (error) {
    if (error instanceof OpenAiClientError) throw new TenancyExtractionError(error.code);
    throw error;
  }
}

function validateExtractionShape(value: unknown): TenancyLegalIntelligence {
  if (!value || typeof value !== 'object') throw new Error('invalid-object');
  const candidate = value as Partial<TenancyLegalIntelligence>;
  if (!candidate.tenant || !candidate.landlord || !candidate.property || !candidate.financial || !candidate.tenancy || !candidate.utilities || !candidate.legal) {
    throw new Error('missing-required-sections');
  }
  return candidate as TenancyLegalIntelligence;
}

function normalizeExtraction(source: TenancyLegalIntelligence): TenancyLegalIntelligence {
  const text = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const money = (value: unknown) => {
    const amount = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
  };
  const party = (value: Partial<LegalParty> | undefined): LegalParty => ({
    name: text(value?.name), company: text(value?.company), ic_passport: text(value?.ic_passport).replace(/\s+/g, ''),
    phone: normalizeMalaysianPhone(text(value?.phone)), email: normalizeEmail(text(value?.email))
  });
  return {
    document_type: text(source.document_type),
    confidence: Math.min(1, Math.max(0, Number(source.confidence) || 0)),
    tenant: party(source.tenant),
    landlord: party(source.landlord),
    property: {
      name: text(source.property?.name), unit: text(source.property?.unit), address: text(source.property?.address),
      type: normalizePropertyType(text(source.property?.type)), build_up: text(source.property?.build_up),
      land_area: text(source.property?.land_area), car_parks: text(source.property?.car_parks)
    },
    financial: {
      monthly_rental: money(source.financial?.monthly_rental), security_deposit: money(source.financial?.security_deposit),
      utility_deposit: money(source.financial?.utility_deposit), access_card_deposit: money(source.financial?.access_card_deposit),
      car_park_deposit: money(source.financial?.car_park_deposit), stamp_duty: money(source.financial?.stamp_duty)
    },
    tenancy: {
      commencement_date: normalizeDate(text(source.tenancy?.commencement_date)),
      expiry_date: normalizeDate(text(source.tenancy?.expiry_date)),
      renewal_option: text(source.tenancy?.renewal_option), notice_period: text(source.tenancy?.notice_period),
      payment_due_day: normalizePaymentDay(text(source.tenancy?.payment_due_day))
    },
    utilities: {
      tnb: text(source.utilities?.tnb), water: text(source.utilities?.water),
      iwk: text(source.utilities?.iwk), wifi: text(source.utilities?.wifi)
    },
    legal: {
      signatures: text(source.legal?.signatures), witnesses: text(source.legal?.witnesses),
      stamp_duty: text(source.legal?.stamp_duty), inventory: text(source.legal?.inventory),
      restrictions: uniqueStrings(source.legal?.restrictions ?? []),
      late_payment: text(source.legal?.late_payment), termination: text(source.legal?.termination),
      viewing_rights: text(source.legal?.viewing_rights), insurance: text(source.legal?.insurance),
      maintenance: text(source.legal?.maintenance), access_card: text(source.legal?.access_card),
      car_park: text(source.legal?.car_park)
    },
    special_clauses: uniqueStrings(source.special_clauses ?? []),
    risks: uniqueRisks(source.risks ?? []),
    warnings: uniqueStrings(source.warnings ?? []),
    field_confidence: normalizeFieldConfidence(source.field_confidence, source)
  };
}

function normalizeMalaysianPhone(value: string): string {
  if (!value) return '';
  const digits = value.replace(/[^0-9+]/g, '').replace(/(?!^)\+/g, '');
  if (/^\+60\d{8,10}$/.test(digits)) return digits;
  if (/^60\d{8,10}$/.test(digits)) return `+${digits}`;
  if (/^0\d{8,10}$/.test(digits)) return `+60${digits.slice(1)}`;
  return digits;
}

function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function normalizeFieldConfidence(value: FieldConfidence | undefined, source: TenancyLegalIntelligence): FieldConfidence {
  const result: FieldConfidence = {};
  for (const path of confidencePaths) {
    const supplied = Number(value?.[path]);
    result[path] = Number.isFinite(supplied) ? Math.round(Math.min(100, Math.max(0, supplied))) : hasPathValue(source, path) ? 50 : 0;
  }
  return result;
}

function hasPathValue(source: TenancyLegalIntelligence, path: string): boolean {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return Array.isArray(current) ? current.length > 0 : typeof current === 'number' ? current > 0 : Boolean(current);
}

function addRisk(risks: LegalRisk[], code: string, severity: LegalRiskSeverity, reason: string, recommendation: string): void {
  risks.push({ code, severity, reason, recommendation });
}

function uniqueRisks(values: unknown[]): LegalRisk[] {
  const seen = new Set<string>();
  const result: LegalRisk[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as Partial<LegalRisk>;
    const code = String(candidate.code ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const reason = String(candidate.reason ?? '').replace(/\s+/g, ' ').trim();
    if (!code || !reason || seen.has(code)) continue;
    seen.add(code);
    const severity = ['low', 'medium', 'high', 'critical'].includes(String(candidate.severity))
      ? candidate.severity as LegalRiskSeverity : 'medium';
    result.push({
      code,
      severity,
      reason,
      recommendation: String(candidate.recommendation ?? 'Review this issue against the signed agreement.').replace(/\s+/g, ' ').trim()
    });
  }
  return result;
}

function normalizeDocumentText(rawText: string): string {
  return rawText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ').replace(/\n{4,}/g, '\n\n\n').trim();
}

function splitOversizedParagraph(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?;。！？；])\s+/);
  if (sentences.length === 1) {
    const pieces: string[] = [];
    for (let offset = 0; offset < paragraph.length; offset += max - 1_200) pieces.push(paragraph.slice(offset, offset + max));
    return pieces;
  }
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && `${current} ${sentence}`.length > max) {
      pieces.push(current);
      current = `${current.slice(-1_200)} ${sentence}`;
    } else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) pieces.push(current);
  return pieces;
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function normalizePropertyType(value: string): string {
  const types = ['Residential', 'Commercial', 'Industrial', 'Office', 'Retail', 'Bungalow', 'Embassy', 'Factory', 'Warehouse', 'Shoplot'];
  return types.find((type) => value.toLowerCase().includes(type.toLowerCase())) ?? value;
}

function normalizeDate(value: string): string {
  if (!value) return '';
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso && isValidDate(iso[1], iso[2], iso[3])) return value;
  const numeric = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (numeric) {
    const [, day, month, year] = numeric;
    const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return isValidDate(year, month, day) ? normalized : '';
  }
  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
  };
  const named = value.toLowerCase().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})$/);
  if (named && months[named[2]]) {
    const normalized = `${named[3]}-${months[named[2]]}-${named[1].padStart(2, '0')}`;
    return isValidDate(named[3], months[named[2]], named[1]) ? normalized : '';
  }
  return '';
}

function isValidDate(year: string, month: string, day: string): boolean {
  const value = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`);
  return !Number.isNaN(value.getTime()) && value.getUTCFullYear() === Number(year)
    && value.getUTCMonth() + 1 === Number(month) && value.getUTCDate() === Number(day);
}

function normalizePaymentDay(value: string): string {
  const day = Number(value.match(/\d{1,2}/)?.[0] ?? 0);
  return day >= 1 && day <= 31 ? String(day) : '';
}

function hasPartyDetails(party: LegalParty): boolean {
  return Boolean(party.name && (party.ic_passport || party.company || party.phone || party.email));
}

function extractRentalAmounts(text: string): number[] {
  const values: number[] = [];
  const pattern = /(?:monthly\s+rent(?:al)?|rent(?:al)?\s+(?:of|is|shall be|payable)?)[\s\S]{0,80}?RM\s*([\d,]+(?:\.\d{1,2})?)/gi;
  for (const match of text.matchAll(pattern)) {
    const amount = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(amount) && amount > 0) values.push(amount);
  }
  return values;
}

function extractDepositMonths(text: string, kind: 'security' | 'utilit'): number | null {
  const pattern = new RegExp(`${kind}[\\s\\S]{0,100}?(\\d+(?:\\.\\d+)?)\\s*months?`, 'i');
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

function hasConflictingDates(extraction: TenancyLegalIntelligence, rawText: string): boolean {
  const { commencement_date: start, expiry_date: end } = extraction.tenancy;
  if (start && end && new Date(`${end}T00:00:00Z`) <= new Date(`${start}T00:00:00Z`)) return true;
  const labelled = [...rawText.matchAll(/(?:commencement|start|expiry|expiration|end)\s+date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/gi)]
    .map((match) => normalizeDate(match[1])).filter(Boolean);
  return new Set(labelled).size > 2;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function formatSummaryDate(value: string): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-MY', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(date);
}

function tenancyDuration(start: string, end: string): string {
  if (!start || !end) return '';
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) return '';
  const months = Math.round((endDate.getTime() - startDate.getTime() + 86_400_000) / (30.4375 * 86_400_000));
  if (months >= 12 && months % 12 === 0) return `${months / 12}-year`;
  return `${months}-month`;
}
