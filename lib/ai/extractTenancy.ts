import type { OcrProvider } from '../ocr/ocrProvider';
import { extractDocumentText } from '../documents/extractText';
import { OpenAiClientError, requestStructuredOpenAi } from './openAiClient';
import { getOpenAiApiKey, getOpenAiConfiguration } from './openAiConfig';
import { buildLegalIntelligence, normalizeClause, type LegalClause, type LegalIntelligenceResult } from '../legal-intelligence/core';
import { logExtractionDiagnostic } from './extractionDiagnostics';
import { formatNexoraDate } from '../dates/formatDate';
import { formatMYR } from '../formatters';
import { normalizeIdentification, normalizePersonName } from './tenancyExtractionContract';
import {
  canonicalTenancyExtractionSchema,
  parseOpenAITenancyResponse,
  type CanonicalTenancyExtraction
} from './tenancyExtractionContract';

export type LegalParty = {
  name: string;
  company: string;
  ic_passport: string;
  identification_type?: string;
  company_number?: string;
  phone: string;
  email: string;
  correspondence_address?: string;
};

export type ExtractedTenancyContact = LegalParty & {
  role: 'tenant' | 'landlord' | 'witness' | 'agent' | 'law_firm';
  represents: 'tenant' | 'landlord' | 'both' | 'neutral' | 'unknown';
  ren_number?: string;
  source_page: number | null;
  source_excerpt: string;
  confidence: number;
};

export type DepositEvidence = {
  amount: number | null;
  basis: 'explicit_amount' | 'rental_multiple' | 'not_found';
  rental_multiple: number | null;
  source_page: number | null;
  source_excerpt: string;
  confidence: number;
  requires_review: boolean;
};

export type NoticePeriodDetails = {
  primary_notice_period: string;
  notice_type: 'non_renewal' | 'termination' | '';
  other_notice_periods: Array<{
    notice_type: 'early_termination' | 'default_cure' | 'viewing' | 'rent_review' | 'renewal_exercise' | 'vacant_possession';
    period: string;
    source_page: number | null;
    source_excerpt: string;
    confidence: number;
  }>;
  source_page: number | null;
  source_excerpt: string;
  confidence: number;
};

export type LegalRiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export type LegalRisk = {
  code: string;
  severity: LegalRiskSeverity;
  category: string;
  reason: string;
  recommendation: string;
  source_page: number | null;
  source_excerpt: string;
};

export type FieldConfidence = Record<string, number>;
export type FieldEvidence = Record<string, {
  value: string;
  confidence: number;
  source_page: number | null;
  source_excerpt: string;
}>;

export type TenancyLegalIntelligence = {
  document_type: string;
  confidence: number;
  tenant: LegalParty;
  landlord: LegalParty;
  contacts?: ExtractedTenancyContact[];
  property: {
    name: string;
    unit: string;
    address: string;
    street?: string;
    postcode?: string;
    city?: string;
    state?: string;
    country?: string;
    type: string;
    build_up: string;
    land_area: string;
    car_parks: string;
  };
  financial: {
    monthly_rental: number | null;
    security_deposit: number | null;
    utility_deposit: number | null;
    access_card_deposit: number | null;
    car_park_deposit: number | null;
    holding_deposit?: number | null;
    booking_fee?: number | null;
    stamp_duty: number | null;
  };
  deposit_details?: {
    security_deposit: DepositEvidence;
    utility_deposit: DepositEvidence;
    access_card_deposit: DepositEvidence;
    car_park_deposit: DepositEvidence;
    key_deposit: DepositEvidence;
    renovation_deposit: DepositEvidence;
    other_deposits: Array<DepositEvidence & { label: string }>;
  };
  tenancy: {
    commencement_date: string;
    expiry_date: string;
    renewal_option: string;
    renewal_period?: string;
    automatic_renewal?: string;
    notice_period: string;
    payment_due_day: string;
  };
  notice_details?: NoticePeriodDetails;
  utilities: {
    tnb: string;
    water: string;
    iwk: string;
    wifi: string;
    aircond?: string;
    maintenance_fee?: string;
    quit_rent?: string;
    assessment?: string;
  };
  payment?: { method: string; bank_name: string; account_number: string; account_holder: string; late_payment_interest: string; grace_period: string };
  parking?: { bays: string; bay_numbers: string; access_cards: string; remote_controls: string; keys: string };
  inventory?: { items: string[]; furnished: string };
  clause_coverage?: {
    pets: boolean; subletting: boolean; airbnb: boolean; illegal_business: boolean; termination: boolean; default: boolean;
    force_majeure: boolean; viewing_rights: boolean; landlord_access: boolean; deposit_refund: boolean; repairs: boolean;
    maintenance: boolean; insurance: boolean;
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
  clauses?: LegalClause[];
  legal_intelligence?: LegalIntelligenceResult;
  special_clauses: string[];
  risks: LegalRisk[];
  warnings: string[];
  field_confidence: FieldConfidence;
  field_evidence: FieldEvidence;
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
  maxOutputTokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  requestId?: string;
};

const confidencePaths = [
  'document_type', 'tenant.name', 'tenant.company', 'tenant.ic_passport', 'tenant.company_number', 'tenant.phone', 'tenant.email', 'tenant.correspondence_address',
  'landlord.name', 'landlord.company', 'landlord.ic_passport', 'landlord.company_number', 'landlord.phone', 'landlord.email', 'landlord.correspondence_address',
  'property.name', 'property.unit', 'property.address', 'property.street', 'property.postcode', 'property.city', 'property.state', 'property.country', 'property.type', 'property.build_up', 'property.land_area', 'property.car_parks',
  'financial.monthly_rental', 'financial.security_deposit', 'financial.utility_deposit', 'financial.access_card_deposit', 'financial.car_park_deposit', 'financial.holding_deposit', 'financial.booking_fee', 'financial.stamp_duty',
  'tenancy.commencement_date', 'tenancy.expiry_date', 'tenancy.renewal_option', 'tenancy.renewal_period', 'tenancy.automatic_renewal', 'tenancy.notice_period', 'tenancy.payment_due_day',
  'payment.method', 'payment.bank_name', 'payment.account_number', 'payment.account_holder', 'payment.late_payment_interest', 'payment.grace_period',
  'utilities.tnb', 'utilities.water', 'utilities.iwk', 'utilities.wifi', 'utilities.aircond', 'utilities.maintenance_fee', 'utilities.quit_rent', 'utilities.assessment',
  'parking.bays', 'parking.bay_numbers', 'parking.access_cards', 'parking.remote_controls', 'parking.keys', 'inventory.items',
  'legal.signatures', 'legal.witnesses', 'legal.stamp_duty', 'legal.inventory', 'legal.restrictions', 'legal.late_payment',
  'legal.termination', 'legal.viewing_rights', 'legal.insurance', 'legal.maintenance', 'legal.access_card', 'legal.car_park',
  'special_clauses'
] as const;
/** @deprecated Model-facing callers use canonicalTenancyExtractionSchema directly. */
export const tenancyLegalIntelligenceSchema = canonicalTenancyExtractionSchema;

const extractionInstructions = `You are Nexora AI Legal Intelligence, a specialist in Malaysian tenancy agreements.
Read every supplied word. Extract facts only from the agreement; never infer identity, contact, property, money, or legal terms that are absent.
Understand English, Simplified or Traditional Chinese, Bahasa Malaysia, and mixed-language Malaysian agreements.
Classify the premises as Residential, Commercial, Industrial, Office, Retail, Bungalow, Embassy, Factory, Warehouse, Shoplot, or the most precise stated type.
Normalize all Malaysian Ringgit values to plain non-negative numbers with no RM symbol or commas. Do not replace an explicit written amount with a calculated amount.
Normalize complete dates to YYYY-MM-DD. Keep an empty string when a date is absent or ambiguous.
Use empty strings, null money values, and empty arrays for facts that are not stated.
Extract tenant, landlord, witness, agent, and law-firm contacts into contacts from every page, signature block, schedule, annexure, agency stamp, payment instruction, and contact-information block. Include every stated name, IC/passport, company registration number, REN number, phone, email, correspondence address, stated role, source page, concise source excerpt, and confidence. Keep the person/company identity value separate from its label. Never treat an NRIC, passport, bank account, date, unit, or page number as a phone number. A witness remains a witness unless an REN number, agency name, negotiator title, agent wording, agency stamp, or matching agent contact evidence supports an agent role.
For tenant and landlord, extract identification_type, company_number, and correspondence_address as well as the core particulars.
Split the property into name, unit_number, street, postcode, city, state, country, and address. The address may retain the complete source address; never invent an address component.
For security, utility, access-card, car-park, key, renovation, holding deposits, booking fee and other deposits, first preserve an explicit monetary amount. When no amount is written but the agreement explicitly gives a rental multiple, calculate it from monthly_rental. Recognize two (2) months rental, two months' rental, one month rental, half month rental, 0.5 month rental, equal to, and equivalent to. Do not calculate when the agreement does not clearly state a rental multiple. Populate deposit_details for every deposit: amount (or null), basis, rental_multiple (or null), source_page, source_excerpt, confidence, and requires_review. Explicit amounts win; if they conflict with a stated rental multiple, preserve the amount and set requires_review true. Use null for unknown values and zero only when the agreement explicitly states no deposit is required.
Separate notice_details into the main non-renewal or ordinary termination notice period and other notice types: early_termination, default_cure, viewing, rent_review, renewal_exercise, and vacant_possession. Never place viewing, breach-cure, or renewal-exercise notice in the primary Notice Period. If no valid non-renewal or ordinary termination notice exists, leave primary_notice_period and tenancy.notice_period blank.
Extract payment method, bank name, account number, account holder, rental due day, late-payment interest, grace period, renewal period, automatic renewal, holding deposit and booking fee.
For utilities record who pays or whether each is included/excluded for electricity/TNB, water, IWK, internet/WiFi, air-conditioning, maintenance fee, quit rent, and assessment.
For parking record bays, bay numbers, access cards, remote controls, and keys. Extract a structured inventory item list for furnished items such as beds, wardrobes, appliances, furniture, curtains, and water heaters.
Set every clause_coverage boolean to true only when a material clause is present. Cover pets, subletting, Airbnb/short stays, illegal business, termination, default, force majeure, viewing rights, landlord access, deposit refund, repairs, maintenance, and insurance.
Preserve material special clauses as concise complete statements.
Extract signatures, witnesses, stamp duty, inventory, restrictions, late-payment terms, termination, viewing rights, insurance, maintenance, access-card and car-park terms.
Identify legal and operational risks, including missing signatures, missing witnesses, missing party IC/passport details, missing stamp duty evidence, conflicting rental amounts or dates, potentially unlawful or unenforceable clauses, no renewal clause, no inspection clause, no termination clause, deposit mismatch, missing inventory, and missing maintenance terms.
Every risk must include a stable snake_case code, severity, evidence-based reason, and practical recommendation.
Return the canonical schema exactly. It has document, confidence, tenant, landlord, contacts, property, financial, deposit_details, tenancy, notice_details, payment, utilities, parking, inventory, clause_coverage, legal, clauses, risks, and warnings. Do not add fields.
Each risk must include a stable snake_case code, severity, category, evidence-based reason, and practical recommendation.
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
  if (normalizedText.length < 80) throw new TenancyExtractionError('text_extraction_failed');

  const apiKey = options.apiKey?.trim() || getOpenAiApiKey();
  if (!apiKey) throw new TenancyExtractionError('openai_not_configured');

  const model = options.model?.trim() || getOpenAiConfiguration().tenancyModel;
  const chunks = splitTenancyDocument(normalizedText, options.maxChunkCharacters);
  const partials: CanonicalTenancyExtraction[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    partials.push(await requestStructuredExtraction({
      apiKey,
      model,
      fetcher: options.fetcher,
      maxOutputTokens: options.maxOutputTokens,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
      requestId: options.requestId,
      prompt: `Document: ${filename}\nSection ${index + 1} of ${chunks.length}. Extract every relevant fact from this section.\n\n${chunks[index]}`
    }));
  }

  const reconciled = partials.length === 1
    ? partials[0]
    : await requestStructuredExtraction({
      apiKey,
      model,
      fetcher: options.fetcher,
      maxOutputTokens: options.maxOutputTokens,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
      requestId: options.requestId,
      prompt: `Reconcile these ordered section extractions from one Malaysian tenancy agreement. Resolve conflicts using repeated agreement evidence, retain facts found in any section, and return one complete record.\n\n${JSON.stringify(partials)}`
    });
  const normalized = validateFieldEvidence(enrichExtractedTenancyTerms(normalizeExtraction(mapCanonicalTenancyExtraction(reconciled)), normalizedText), normalizedText);
  const extraction = applyRiskEngine(normalized, normalizedText);

  return {
    extraction,
    rawText: normalizedText,
    summary: reconciled.document.summary || createTenancySummary(extraction),
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

/**
 * Fills a deposit only when the agreement itself supplies an unambiguous amount
 * or rental multiple. Explicit amounts, including an explicit zero, always win.
 */
export function enrichExtractedTenancyTerms(
  source: TenancyLegalIntelligence,
  rawText: string
): TenancyLegalIntelligence {
  const extraction = normalizeExtraction(source);
  const monthlyRental = extraction.financial.monthly_rental;
  const financial = { ...extraction.financial };
  const evidence = { ...extraction.field_evidence };
  const warnings = [...extraction.warnings];
  const depositDetails = { ...defaultDepositDetails(), ...extraction.deposit_details };
  const deposits: Array<{ field: keyof Pick<TenancyLegalIntelligence['financial'], 'security_deposit' | 'utility_deposit' | 'access_card_deposit' | 'car_park_deposit'>; label: string; aliases: string[] }> = [
    { field: 'security_deposit', label: 'Security deposit', aliases: ['security deposit', 'earnest deposit'] },
    { field: 'utility_deposit', label: 'Utility deposit', aliases: ['utility deposit', 'utilities deposit'] },
    { field: 'access_card_deposit', label: 'Access card deposit', aliases: ['access card deposit', 'access deposit'] },
    { field: 'car_park_deposit', label: 'Car park deposit', aliases: ['car park deposit', 'parking deposit', 'remote control deposit', 'car park remote deposit'] }
  ];

  for (const deposit of deposits) {
    const existing = depositDetails[deposit.field];
    const explicit = findExplicitDepositAmount(rawText, deposit.aliases);
    if (explicit) {
      const multiple = findDepositRentalMultiple(rawText, deposit.aliases);
      const expected = multiple && monthlyRental !== null ? roundMoney(monthlyRental * multiple.months) : null;
      const requiresReview = Boolean(expected !== null && Math.abs(expected - explicit.amount) > 1);
      financial[deposit.field] = explicit.amount;
      depositDetails[deposit.field] = {
        amount: explicit.amount, basis: 'explicit_amount', rental_multiple: multiple?.months ?? null,
        source_page: explicit.page, source_excerpt: explicit.excerpt, confidence: 98, requires_review: requiresReview
      };
      evidence[`financial.${deposit.field}`] = { value: String(explicit.amount), confidence: 98, source_page: explicit.page, source_excerpt: explicit.excerpt };
      if (requiresReview) warnings.push(`Requires confirmation: ${deposit.label.toLowerCase()} conflicts with the stated rental multiple.`);
      continue;
    }
    if (existing.amount !== null && existing.basis === 'explicit_amount') {
      financial[deposit.field] = existing.amount;
      continue;
    }
    const multiple = findDepositRentalMultiple(rawText, deposit.aliases);
    if (multiple === null || monthlyRental === null) continue;
    const amount = roundMoney(monthlyRental * multiple.months);
    financial[deposit.field] = amount;
    depositDetails[deposit.field] = {
      amount, basis: 'rental_multiple', rental_multiple: multiple.months,
      source_page: multiple.page, source_excerpt: multiple.excerpt, confidence: 88, requires_review: false
    };
    evidence[`financial.${deposit.field}`] = { value: String(amount), confidence: 88, source_page: multiple.page, source_excerpt: multiple.excerpt };
    warnings.push(`${deposit.label} was calculated from the stated ${multiple.months}-month rental multiple; verify the agreement wording.`);
  }
  for (const deposit of deposits) {
    if (financial[deposit.field] === 0 && depositDetails[deposit.field].amount === null) financial[deposit.field] = null;
  }
  for (const deposit of [
    { key: 'key_deposit' as const, label: 'Key deposit', aliases: ['key deposit', 'key(s) deposit'] },
    { key: 'renovation_deposit' as const, label: 'Renovation deposit', aliases: ['renovation deposit', 'renovation security deposit'] }
  ]) {
    const explicit = findExplicitDepositAmount(rawText, deposit.aliases);
    if (explicit) depositDetails[deposit.key] = {
      amount: explicit.amount, basis: 'explicit_amount', rental_multiple: null, source_page: explicit.page,
      source_excerpt: explicit.excerpt, confidence: 98, requires_review: false
    };
  }
  const knownDepositLabels = /security|earnest|utility|utilities|access|car\s*park|parking|remote|key|renovation/i;
  const otherDeposits = rawText.split(/\r?\n/).flatMap((line) => {
    const label = line.match(/\b([a-z][a-z /-]{0,60}\s+deposit)\b/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
    const amount = line.match(/\b(?:RM|MYR)\s*([\d,]+(?:\.\d{1,2})?)\b/i)?.[1];
    if (!label || !amount || knownDepositLabels.test(label)) return [];
    const value = Number(amount.replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 0) return [];
    const source = findSourceExcerpt(rawText, new RegExp(escapeRegExp(line.trim()), 'i'));
    return [{
      label, amount: roundMoney(value), basis: 'explicit_amount' as const, rental_multiple: null,
      source_page: source.page, source_excerpt: source.excerpt, confidence: 95, requires_review: false
    }];
  });
  depositDetails.other_deposits = uniqueDepositDetails([...depositDetails.other_deposits, ...otherDeposits]);
  const withDeposits = {
    ...extraction,
    financial,
    deposit_details: depositDetails,
    field_evidence: evidence,
    warnings: uniqueStrings(warnings)
  };
  return enrichNoticePeriods(enrichContactsFromDocument(withDeposits, rawText), rawText);
}

function defaultDepositEvidence(): DepositEvidence {
  return { amount: null, basis: 'not_found', rental_multiple: null, source_page: null, source_excerpt: '', confidence: 0, requires_review: false };
}

function defaultDepositDetails(): NonNullable<TenancyLegalIntelligence['deposit_details']> {
  return {
    security_deposit: defaultDepositEvidence(), utility_deposit: defaultDepositEvidence(),
    access_card_deposit: defaultDepositEvidence(), car_park_deposit: defaultDepositEvidence(),
    key_deposit: defaultDepositEvidence(), renovation_deposit: defaultDepositEvidence(), other_deposits: []
  };
}

function uniqueDepositDetails(values: Array<DepositEvidence & { label: string }>): Array<DepositEvidence & { label: string }> {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.label}:${item.amount ?? ''}:${item.source_page ?? ''}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enrichNoticePeriods(source: TenancyLegalIntelligence, rawText: string): TenancyLegalIntelligence {
  const occurrences = findNoticeOccurrences(rawText);
  const primary = occurrences.find((item): item is NoticeOccurrence & { notice_type: 'non_renewal' | 'termination' } => item.notice_type === 'non_renewal')
    ?? occurrences.find((item): item is NoticeOccurrence & { notice_type: 'non_renewal' | 'termination' } => item.notice_type === 'termination')
    ?? null;
  const other = occurrences.flatMap((item) => item !== primary && item.notice_type !== 'non_renewal' && item.notice_type !== 'termination'
    ? [{ ...item, notice_type: item.notice_type as NoticePeriodDetails['other_notice_periods'][number]['notice_type'] }] : []);
  const textContainsNoticeTerms = /notice|terminat|determination|expiry|renewal|view(?:ing)?|inspect|breach|default|vacant/i.test(rawText);
  const fallbackPrimary = !primary && !textContainsNoticeTerms && !isAmbiguousNoticePeriod(source.tenancy.notice_period)
    ? normalizeNoticePeriod(source.tenancy.notice_period) : '';
  const details: NoticePeriodDetails = primary ? {
    primary_notice_period: primary.period,
    notice_type: primary.notice_type,
    other_notice_periods: other,
    source_page: primary.source_page,
    source_excerpt: primary.source_excerpt,
    confidence: primary.confidence
  } : {
    primary_notice_period: fallbackPrimary, notice_type: fallbackPrimary ? 'termination' : '', other_notice_periods: other,
    source_page: null, source_excerpt: '', confidence: fallbackPrimary ? 50 : 0
  };
  const warnings = [...source.warnings];
  if (!primary && !fallbackPrimary) warnings.push('Missing from document: primary notice period.');
  return {
    ...source,
    tenancy: { ...source.tenancy, notice_period: primary?.period ?? fallbackPrimary },
    notice_details: details,
    warnings: uniqueStrings(warnings)
  };
}

type NoticeOccurrence = Omit<NoticePeriodDetails['other_notice_periods'][number], 'notice_type'> & {
  notice_type: NoticePeriodDetails['other_notice_periods'][number]['notice_type'] | 'non_renewal' | 'termination';
};

function findNoticeOccurrences(rawText: string): NoticeOccurrence[] {
  const occurrences: NoticeOccurrence[] = [];
  const seen = new Set<string>();
  for (const line of rawText.split(/\r?\n/)) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!normalized || !/notice|not less than|prior written|written notice|vacant possession|cure period/i.test(normalized)) continue;
    const type = classifyNoticeType(normalized);
    const period = extractNoticeDuration(normalized);
    if (!type || !period) continue;
    const source = findSourceExcerpt(rawText, new RegExp(escapeRegExp(normalized), 'i'));
    const key = `${type}:${period}:${source.page ?? ''}:${normalized.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    occurrences.push({ notice_type: type, period, source_page: source.page, source_excerpt: source.excerpt, confidence: 93 });
  }
  return occurrences;
}

function classifyNoticeType(value: string): NoticePeriodDetails['other_notice_periods'][number]['notice_type'] | 'non_renewal' | 'termination' | null {
  const text = value.toLowerCase();
  if (/view(?:ing)?|inspect(?:ion)?|access to premises|entry to premises/.test(text)) return 'viewing';
  if (/breach|default|remed(?:y|ied)|cure/.test(text)) return 'default_cure';
  if (/rent(?:al)? review|review of rent/.test(text)) return 'rent_review';
  if (/option to renew|exercise (?:the )?(?:renewal )?option|renewal exercise/.test(text)) return 'renewal_exercise';
  if (/vacant possession|vacate|handover|hand over/.test(text)) return 'vacant_possession';
  if (/early (?:termination|terminate)|terminate early|premature termination/.test(text)) return 'early_termination';
  if (/non[-\s]?renew|not renew|before (?:the )?expiry|upon expiry|expiry.*notice/.test(text)) return 'non_renewal';
  if (/terminat|determination|either party may.*notice|party may.*notice/.test(text)) return 'termination';
  return null;
}

function extractNoticeDuration(value: string): string {
  const words: Record<string, number> = {
    half: 0.5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirty: 30, sixty: 60, ninety: 90
  };
  const match = value.toLowerCase().match(/(?:not\s+less\s+than\s+)?(half|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirty|sixty|ninety|\d+(?:\.\d+)?)(?:\s*\(\s*(\d+(?:\.\d+)?)\s*\))?\s*(hour|day|week|month|year)s?\b/i);
  if (!match) return '';
  const amount = Number(match[2] ?? words[match[1].toLowerCase()] ?? match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const unit = match[3].toLowerCase();
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`;
}

function enrichContactsFromDocument(source: TenancyLegalIntelligence, rawText: string): TenancyLegalIntelligence {
  const evidence = { ...source.field_evidence };
  const enrichParty = (party: LegalParty, role: 'tenant' | 'landlord'): LegalParty => {
    const details = findPartyContactDetails(rawText, role);
    const result = { ...party };
    if (!result.phone && details.phone) {
      result.phone = details.phone.value;
      evidence[`${role}.phone`] = { value: details.phone.value, confidence: 92, source_page: details.phone.page, source_excerpt: details.phone.excerpt };
    }
    if (!result.email && details.email) {
      result.email = details.email.value;
      evidence[`${role}.email`] = { value: details.email.value, confidence: 96, source_page: details.email.page, source_excerpt: details.email.excerpt };
    }
    return result;
  };
  return {
    ...source,
    tenant: enrichParty(source.tenant, 'tenant'),
    landlord: enrichParty(source.landlord, 'landlord'),
    field_evidence: evidence
  };
}

function findPartyContactDetails(rawText: string, role: 'tenant' | 'landlord'): {
  phone?: { value: string; page: number | null; excerpt: string };
  email?: { value: string; page: number | null; excerpt: string };
} {
  const rolePattern = role === 'tenant' ? '(?:tenant|lessee|penyewa)' : '(?:landlord|owner|lessor|tuan\\s*rumah)';
  const start = new RegExp(`(?:^|\\n)\\s*${rolePattern}\\b[\\s\\S]{0,650}`, 'ig');
  for (const match of rawText.matchAll(start)) {
    const block = match[0].replace(/^\s+/, '').split(/\n\s*(?:tenant|lessee|landlord|owner|lessor|penyewa|tuan\s*rumah)\b/i)[0];
    const emailMatch = block.match(/(?:e-?mail)\s*(?:address)?\s*[:#-]?\s*([^\s,;]+@[^\s,;]+)/i)
      ?? block.match(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
    const phoneMatch = block.match(/(?:phone|telephone|tel|mobile|contact)\s*(?:no\.?|number)?\s*[:#-]?\s*([+0-9][0-9\s()-]{7,18})/i);
    const phone = normalizeMalaysianPhone(phoneMatch?.[1] ?? '');
    const email = normalizeEmail(emailMatch?.[1] ?? '');
    if (!phone && !email) continue;
    const source = findSourceExcerpt(rawText, new RegExp(escapeRegExp(block.replace(/\s+/g, ' ').trim()), 'i'));
    return {
      ...(phone ? { phone: { value: phone, page: source.page, excerpt: source.excerpt } } : {}),
      ...(email ? { email: { value: email, page: source.page, excerpt: source.excerpt } } : {})
    };
  }
  return {};
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
  if (!/stamp duty|stamping|duly stamped|hasil|lhdn|setem/.test(text) && (extraction.financial.stamp_duty === null || extraction.financial.stamp_duty === 0)) {
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
  if (new Set(rentalValues.map((value) => value.toFixed(2))).size > 1) {
    addRisk(risks, 'rental_inconsistency', 'high', 'Conflicting monthly rental amounts were detected.', 'Verify the operative rental amount across the body, schedules, and payment clauses.', 'financial');
    warnings.push('Conflicting monthly rental values require manual review.');
  }

  const expectedSecurityMonths = extractDepositMonths(rawText, 'security');
  if (expectedSecurityMonths !== null && isPositiveMoney(extraction.financial.monthly_rental) && extraction.financial.security_deposit !== null) {
    const expected = extraction.financial.monthly_rental * expectedSecurityMonths;
    if (Math.abs(expected - extraction.financial.security_deposit) > 1) {
      const source = findDepositRentalMultiple(rawText, ['security deposit', 'earnest deposit']);
      addRisk(risks, 'security_deposit_mismatch', 'high', 'Requires confirmation: the extracted security deposit amount is preserved but conflicts with the stated rental-month multiple.', 'Reconcile the stated multiple and payable amount without overwriting the extracted value.', 'financial', source?.page ?? null, source?.excerpt ?? '');
      warnings.push('Requires confirmation: security deposit conflicts with the stated rental multiple.');
    }
  }
  const expectedUtilityMonths = extractDepositMonths(rawText, 'utilit');
  if (expectedUtilityMonths !== null && isPositiveMoney(extraction.financial.monthly_rental) && extraction.financial.utility_deposit !== null) {
    const expected = extraction.financial.monthly_rental * expectedUtilityMonths;
    if (Math.abs(expected - extraction.financial.utility_deposit) > 1) {
      const source = findDepositRentalMultiple(rawText, ['utility deposit', 'utilities deposit']);
      addRisk(risks, 'utility_deposit_mismatch', 'high', 'Requires confirmation: the extracted utility deposit amount is preserved but conflicts with the stated rental-month multiple.', 'Reconcile the stated multiple and payable amount without overwriting the extracted value.', 'financial', source?.page ?? null, source?.excerpt ?? '');
      warnings.push('Requires confirmation: utility deposit conflicts with the stated rental multiple.');
    }
  }

  const unusualClause = findSourceExcerpt(rawText, /evict.{0,80}without (?:a )?court|enter.{0,80}without (?:prior )?notice|forfeit.{0,80}without notice|waive.{0,80}(?:legal|statutory) rights?/i);
  if (unusualClause.excerpt) {
    addRisk(risks, 'unusual_forfeiture_or_entry_clause', 'critical', 'A potentially unusual, unlawful, or unenforceable forfeiture, eviction, entry, or rights-waiver clause was detected.', 'Obtain Malaysian legal advice and revise the clause before relying on it.', 'forfeiture_and_access', unusualClause.page, unusualClause.excerpt);
  }
  if (hasConflictingDates(extraction, rawText)) {
    addRisk(risks, 'conflicting_dates', 'high', 'Conflicting tenancy dates were detected.', 'Reconcile commencement, term, and expiry dates throughout the agreement.', 'tenancy_period');
    warnings.push('Conflicting tenancy dates require manual review.');
  }
  if (hasInvalidTenancyPeriod(extraction)) addRisk(risks, 'invalid_tenancy_period', 'high', 'The expiry date is not later than the commencement date.', 'Correct the commencement and expiry dates before confirming the tenancy.', 'tenancy_period');
  if (isAmbiguousNoticePeriod(extraction.tenancy.notice_period)) addRisk(risks, 'ambiguous_notice_period', 'medium', 'Missing from document: the ordinary non-renewal or termination notice period is not stated clearly.', 'Confirm the required notice duration and whether it is measured in days or months.', 'termination');
  if (!/(?:tenant|landlord|lessee|lessor|penyewa|tuan rumah)[\s\S]{0,120}(?:tnb|electric|water|iwk|wifi|utilities|utilit|air|elektrik)/i.test(rawText)) {
    addRisk(risks, 'unclear_utility_responsibility', 'medium', 'Responsibility for utilities is not clearly allocated between the parties.', 'State which party pays and manages each utility account.', 'utilities');
  }
  if (!/(?:tenant|landlord|lessee|lessor|penyewa|tuan rumah)[\s\S]{0,120}(?:repair|maintain|maintenance|pembaikan|penyelenggaraan)/i.test(rawText)) {
    addRisk(risks, 'unclear_repair_responsibility', 'medium', 'Repair and maintenance responsibility is not clearly allocated between the parties.', 'Define responsibility for routine, structural, emergency, and damage-related repairs.', 'maintenance');
  }
  if (!extraction.tenancy.commencement_date) warnings.push('Commencement date was not reliably detected.');
  if (!extraction.tenancy.expiry_date) warnings.push('Expiry date was not reliably detected.');
  if (extraction.confidence < 0.75) warnings.push('Overall extraction confidence is below 75%; verify against the source document.');

  const completed = { ...extraction, risks: uniqueRisks(risks), warnings: uniqueStrings(warnings) };
  return attachLegalIntelligence(completed, rawText);
}

export function attachLegalIntelligence(
  extraction: TenancyLegalIntelligence,
  rawText: string,
  build: typeof buildLegalIntelligence = buildLegalIntelligence
): TenancyLegalIntelligence {
  try {
    const legalIntelligence = build(extraction, rawText);
    return { ...extraction, clauses: legalIntelligence.clauses, legal_intelligence: legalIntelligence };
  } catch (error) {
    logExtractionDiagnostic('legal_analysis_failed', {
      stage: 'mapping',
      errorName: error instanceof Error ? error.name : 'unknown',
      errorCode: 'legal-analysis-failed'
    });
    return {
      ...extraction,
      clauses: [],
      warnings: uniqueStrings([...extraction.warnings, 'Legal analysis was unavailable; the base tenancy extraction is ready for review.'])
    };
  }
}

export function createTenancySummary(extraction: TenancyLegalIntelligence): string {
  const type = extraction.property.type || extraction.document_type || 'tenancy';
  const commencement = formatSummaryDate(extraction.tenancy.commencement_date);
  const duration = tenancyDuration(extraction.tenancy.commencement_date, extraction.tenancy.expiry_date);
  const opening = `This is a ${duration ? `${duration} ` : ''}${type.toLowerCase()} tenancy${commencement ? ` commencing on ${commencement}` : ''}`;
  const money = extraction.financial;
  const amounts = [
    isPositiveMoney(money.monthly_rental) ? `${formatMYR(money.monthly_rental)} monthly rental` : '',
    isPositiveMoney(money.security_deposit) ? `${formatMYR(money.security_deposit)} security deposit` : '',
    isPositiveMoney(money.utility_deposit) ? `${formatMYR(money.utility_deposit)} utility deposit` : ''
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
  maxOutputTokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  requestId?: string;
}): Promise<CanonicalTenancyExtraction> {
  try {
    return await requestStructuredOpenAi({
      apiKey: input.apiKey,
      model: input.model,
      fetcher: input.fetcher,
      schemaName: 'malaysian_tenancy_legal_intelligence',
      schema: canonicalTenancyExtractionSchema,
      system: extractionInstructions,
      prompt: input.prompt,
      maxOutputTokens: input.maxOutputTokens ?? 12_000,
      timeoutMs: input.timeoutMs,
      maxAttempts: input.maxAttempts,
      requestId: input.requestId,
      parseResponse: parseOpenAITenancyResponse
    });
  } catch (error) {
    if (error instanceof OpenAiClientError) throw new TenancyExtractionError(error.code);
    throw error;
  }
}

export function mapCanonicalTenancyExtraction(source: CanonicalTenancyExtraction): TenancyLegalIntelligence {
  const confidence = Math.round(Math.max(0, Math.min(1, source.confidence)) * 100);
  const presentConfidence = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0) ? 0 : confidence;
  const field_confidence = Object.fromEntries(confidencePaths.map((path) => [path, 0])) as FieldConfidence;
  const extraction: TenancyLegalIntelligence = {
    document_type: source.document.type,
    confidence: source.confidence,
    tenant: mapParty(source.tenant),
    landlord: mapParty(source.landlord),
    contacts: normalizeContacts(source.contacts.map((contact) => ({ ...mapParty(contact), role: contact.role, represents: contact.represents, ren_number: contact.ren_number, source_page: contact.source_page, source_excerpt: contact.source_excerpt, confidence: Math.round(contact.confidence * 100) }))),
    property: {
      name: source.property.name,
      unit: source.property.unit_number,
      address: source.property.address,
      street: source.property.street,
      postcode: source.property.postcode,
      city: source.property.city,
      state: source.property.state,
      country: source.property.country,
      type: source.property.property_type,
      build_up: source.property.build_up,
      land_area: source.property.land_area,
      car_parks: source.property.car_parks
    },
    financial: {
      monthly_rental: source.financial.monthly_rental,
      security_deposit: source.financial.security_deposit,
      utility_deposit: source.financial.utility_deposit,
      access_card_deposit: source.financial.access_card_deposit,
      car_park_deposit: source.financial.car_park_deposit,
      holding_deposit: source.financial.holding_deposit,
      booking_fee: source.financial.booking_fee,
      stamp_duty: source.financial.stamp_duty
    },
    deposit_details: source.deposit_details,
    tenancy: { ...source.tenancy, payment_due_day: source.tenancy.payment_due_day ?? '' },
    notice_details: source.notice_details,
    payment: source.payment,
    utilities: source.utilities,
    parking: source.parking,
    inventory: source.inventory,
    clause_coverage: source.clause_coverage,
    legal: source.legal,
    special_clauses: source.clauses,
    risks: source.risks.map((risk) => ({ ...risk, source_page: null, source_excerpt: '' })),
    warnings: source.warnings,
    field_confidence,
    field_evidence: {}
  };
  for (const path of confidencePaths) field_confidence[path] = presentConfidence(serializePathValue(extraction, path));
  return extraction;
}

function mapParty(source: { name: string; company: string; identification: string; identification_type: string; company_number: string; phone: string; email: string; correspondence_address: string }): LegalParty {
  return {
    name: normalizePersonName(source.name),
    company: source.company,
    ic_passport: normalizeIdentification(source.identification),
    identification_type: source.identification_type,
    company_number: normalizeIdentification(source.company_number),
    phone: source.phone,
    email: source.email,
    correspondence_address: source.correspondence_address
  };
}

function normalizeExtraction(source: TenancyLegalIntelligence): TenancyLegalIntelligence {
  const text = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const money = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const amount = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
  };
  const party = (value: Partial<LegalParty> | undefined): LegalParty => ({
    name: normalizePersonName(value?.name), company: text(value?.company), ic_passport: normalizeIdentification(value?.ic_passport).replace(/\s+/g, ''),
    identification_type: text(value?.identification_type), company_number: normalizeIdentification(value?.company_number).replace(/\s+/g, ''),
    phone: normalizeMalaysianPhone(text(value?.phone)), email: normalizeEmail(text(value?.email)), correspondence_address: text(value?.correspondence_address)
  });
  return {
    document_type: text(source.document_type),
    confidence: Math.min(1, Math.max(0, Number(source.confidence) || 0)),
    tenant: party(source.tenant),
    landlord: party(source.landlord),
    contacts: normalizeContacts(source.contacts),
    property: {
      name: text(source.property?.name), unit: text(source.property?.unit), address: text(source.property?.address),
      street: text(source.property?.street), postcode: text(source.property?.postcode), city: text(source.property?.city),
      state: text(source.property?.state), country: text(source.property?.country),
      type: normalizePropertyType(text(source.property?.type)), build_up: normalizeArea(text(source.property?.build_up)),
      land_area: normalizeArea(text(source.property?.land_area)), car_parks: text(source.property?.car_parks)
    },
    financial: {
      monthly_rental: money(source.financial?.monthly_rental), security_deposit: money(source.financial?.security_deposit),
      utility_deposit: money(source.financial?.utility_deposit), access_card_deposit: money(source.financial?.access_card_deposit),
      car_park_deposit: money(source.financial?.car_park_deposit), holding_deposit: money(source.financial?.holding_deposit),
      booking_fee: money(source.financial?.booking_fee), stamp_duty: money(source.financial?.stamp_duty)
    },
    deposit_details: normalizeDepositDetails(source.deposit_details),
    tenancy: {
      commencement_date: normalizeDate(text(source.tenancy?.commencement_date)),
      expiry_date: normalizeDate(text(source.tenancy?.expiry_date)),
      renewal_option: normalizePercentages(text(source.tenancy?.renewal_option)), renewal_period: normalizeNoticePeriod(text(source.tenancy?.renewal_period)),
      automatic_renewal: text(source.tenancy?.automatic_renewal), notice_period: normalizeNoticePeriod(text(source.tenancy?.notice_period)),
      payment_due_day: normalizePaymentDay(text(source.tenancy?.payment_due_day))
    },
    notice_details: normalizeNoticeDetails(source.notice_details),
    utilities: {
      tnb: text(source.utilities?.tnb), water: text(source.utilities?.water),
      iwk: text(source.utilities?.iwk), wifi: text(source.utilities?.wifi), aircond: text(source.utilities?.aircond),
      maintenance_fee: text(source.utilities?.maintenance_fee), quit_rent: text(source.utilities?.quit_rent), assessment: text(source.utilities?.assessment)
    },
    payment: normalizePayment(source.payment),
    parking: normalizeParking(source.parking),
    inventory: { items: uniqueStrings(source.inventory?.items ?? []), furnished: text(source.inventory?.furnished) },
    clause_coverage: normalizeClauseCoverage(source.clause_coverage),
    legal: {
      signatures: text(source.legal?.signatures), witnesses: text(source.legal?.witnesses),
      stamp_duty: text(source.legal?.stamp_duty), inventory: text(source.legal?.inventory),
      restrictions: uniqueStrings(source.legal?.restrictions ?? []),
      late_payment: normalizePercentages(text(source.legal?.late_payment)), termination: normalizeNoticeText(text(source.legal?.termination)),
      viewing_rights: text(source.legal?.viewing_rights), insurance: text(source.legal?.insurance),
      maintenance: text(source.legal?.maintenance), access_card: text(source.legal?.access_card),
      car_park: text(source.legal?.car_park)
    },
    clauses: (Array.isArray(source.clauses) ? source.clauses : []).map((item) => normalizeClause(item)).filter((item): item is LegalClause => item !== null),
    legal_intelligence: source.legal_intelligence ?? { version: 'sprint-015-v1', executive_summary: '', normalized_fields: {}, clauses: [], risks: [] },
    special_clauses: uniqueStrings(source.special_clauses ?? []).map(normalizePercentages),
    risks: uniqueRisks(source.risks ?? []),
    warnings: uniqueStrings(source.warnings ?? []),
    field_confidence: normalizeFieldConfidence(source.field_confidence, source),
    field_evidence: normalizeFieldEvidence(source.field_evidence, source, source.field_confidence)
  };
}

function normalizeDepositDetails(value: TenancyLegalIntelligence['deposit_details']): NonNullable<TenancyLegalIntelligence['deposit_details']> {
  const defaults = defaultDepositDetails();
  const normalize = (item: Partial<DepositEvidence> | undefined): DepositEvidence => {
    const amount = item?.amount;
    const normalizedAmount = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
    const basis = item?.basis === 'explicit_amount' || item?.basis === 'rental_multiple' || item?.basis === 'not_found'
      ? item.basis : normalizedAmount === null ? 'not_found' : 'explicit_amount';
    const multiple = typeof item?.rental_multiple === 'number' && Number.isFinite(item.rental_multiple) && item.rental_multiple >= 0
      ? item.rental_multiple : null;
    return {
      amount: normalizedAmount, basis: normalizedAmount === null ? 'not_found' : basis, rental_multiple: multiple,
      source_page: Number.isInteger(item?.source_page) && Number(item?.source_page) > 0 ? Number(item?.source_page) : null,
      source_excerpt: extractionText(item?.source_excerpt).slice(0, 500),
      confidence: Math.max(0, Math.min(100, Number(item?.confidence) || 0)),
      requires_review: item?.requires_review === true
    };
  };
  const source = value ?? defaults;
  return {
    security_deposit: normalize(source.security_deposit), utility_deposit: normalize(source.utility_deposit),
    access_card_deposit: normalize(source.access_card_deposit), car_park_deposit: normalize(source.car_park_deposit),
    key_deposit: normalize(source.key_deposit), renovation_deposit: normalize(source.renovation_deposit),
    other_deposits: Array.isArray(source.other_deposits) ? source.other_deposits.flatMap((item) => {
      const label = extractionText(item.label);
      return label ? [{ ...normalize(item), label }] : [];
    }) : []
  };
}

function normalizeNoticeDetails(value: TenancyLegalIntelligence['notice_details']): NoticePeriodDetails {
  const source = value;
  const primary = normalizeNoticePeriod(extractionText(source?.primary_notice_period));
  const noticeType = source?.notice_type === 'non_renewal' || source?.notice_type === 'termination' ? source.notice_type : '';
  const allowed = new Set<NoticePeriodDetails['other_notice_periods'][number]['notice_type']>(['early_termination', 'default_cure', 'viewing', 'rent_review', 'renewal_exercise', 'vacant_possession']);
  return {
    primary_notice_period: primary,
    notice_type: primary ? noticeType || 'termination' : '',
    other_notice_periods: Array.isArray(source?.other_notice_periods) ? source.other_notice_periods.flatMap((item) => {
      if (!allowed.has(item.notice_type)) return [];
      const period = normalizeNoticePeriod(item.period);
      return period ? [{
        notice_type: item.notice_type, period,
        source_page: Number.isInteger(item.source_page) && Number(item.source_page) > 0 ? Number(item.source_page) : null,
        source_excerpt: extractionText(item.source_excerpt).slice(0, 500),
        confidence: Math.max(0, Math.min(100, Number(item.confidence) || 0))
      }] : [];
    }) : [],
    source_page: Number.isInteger(source?.source_page) && Number(source?.source_page) > 0 ? Number(source?.source_page) : null,
    source_excerpt: extractionText(source?.source_excerpt).slice(0, 500),
    confidence: Math.max(0, Math.min(100, Number(source?.confidence) || 0))
  };
}

function normalizeMalaysianPhone(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('60') ? `0${digits.slice(2)}` : digits;
  // Malaysian mobile and landline lengths only; never surface account, passport, NRIC, date, or page values as phones.
  if (!/^0(?:1\d{7,8}|[3-9]\d{7,8})$/.test(local)) return '';
  return `+60${local.slice(1)}`;
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

function normalizeArea(value: string): string {
  return value.replace(/\b(?:square\s+feet|square\s+foot|sq\.?\s*ft\.?)\b/gi, 'sq ft')
    .replace(/\b(?:square\s+metres?|square\s+meters?|sq\.?\s*m\.?)\b/gi, 'sq m').replace(/\s+/g, ' ').trim();
}

function normalizePercentages(value: string): string {
  return value.replace(/(\d+(?:\.\d+)?)\s*(?:percent|per cent)/gi, '$1%').replace(/\s+%/g, '%');
}

function normalizeNoticePeriod(value: string): string {
  if (!value) return '';
  const normalized = normalizeNoticeText(value);
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(day|week|month|year)s?/i);
  return match ? `${Number(match[1])} ${match[2].toLowerCase()}${Number(match[1]) === 1 ? '' : 's'}` : normalized;
}

function normalizeNoticeText(value: string): string {
  const words: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12' };
  return Object.entries(words).reduce((current, [word, number]) => current.replace(new RegExp(`\\b${word}(?:\\s*\\(${number}\\))?\\b`, 'gi'), number), value)
    .replace(/\b(\d+)\s*\(\1\)/g, '$1').replace(/\s+/g, ' ').trim();
}

function normalizeFieldEvidence(value: FieldEvidence | undefined, source: TenancyLegalIntelligence, confidence: FieldConfidence | undefined): FieldEvidence {
  const result: FieldEvidence = {};
  for (const path of confidencePaths) {
    const present = hasPathValue(source, path);
    const supplied = value?.[path];
    const score = Number(supplied?.confidence ?? confidence?.[path]);
    result[path] = {
      value: present ? serializePathValue(source, path) : '',
      confidence: present && Number.isFinite(score) ? Math.round(Math.min(100, Math.max(0, score))) : present ? 50 : 0,
      source_page: present && Number.isInteger(supplied?.source_page) && Number(supplied?.source_page) > 0 ? Number(supplied?.source_page) : null,
      source_excerpt: present ? String(supplied?.source_excerpt ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) : ''
    };
  }
  return result;
}

function validateFieldEvidence(extraction: TenancyLegalIntelligence, rawText: string): TenancyLegalIntelligence {
  const normalizedSource = rawText.replace(/\s+/g, ' ').toLowerCase();
  const evidence: FieldEvidence = {};
  const warnings = [...extraction.warnings];
  for (const path of confidencePaths) {
    const item = extraction.field_evidence[path];
    const value = serializePathValue(extraction, path);
    const present = hasPathValue(extraction, path);
    const excerpt = item?.source_excerpt.replace(/\s+/g, ' ').trim() ?? '';
    const excerptSupported = Boolean(excerpt) && normalizedSource.includes(excerpt.toLowerCase());
    if (excerpt && !excerptSupported) warnings.push(`Source excerpt for ${path} could not be verified against the extracted document text.`);
    evidence[path] = {
      value: present ? value : '',
      confidence: present ? Math.min(item?.confidence ?? extraction.field_confidence[path] ?? 50, excerptSupported ? 100 : 79) : 0,
      source_page: present && excerptSupported ? sourcePageForExcerpt(rawText, excerpt) : null,
      source_excerpt: present && excerptSupported ? excerpt : ''
    };
  }
  const risks = extraction.risks.map((risk) => {
    const excerpt = risk.source_excerpt.replace(/\s+/g, ' ').trim();
    const supported = Boolean(excerpt) && normalizedSource.includes(excerpt.toLowerCase());
    if (excerpt && !supported) warnings.push(`Source excerpt for risk ${risk.code} could not be verified against the extracted document text.`);
    return { ...risk, source_excerpt: supported ? excerpt : '', source_page: supported ? sourcePageForExcerpt(rawText, excerpt) : null };
  });
  return {
    ...extraction,
    warnings: uniqueStrings(warnings),
    risks,
    field_evidence: evidence,
    field_confidence: Object.fromEntries(Object.entries(evidence).map(([path, item]) => [path, item.confidence]))
  };
}

function serializePathValue(source: TenancyLegalIntelligence, path: string): string {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[segment];
  }
  return Array.isArray(current) ? current.join('; ') : current === null || current === undefined ? '' : String(current);
}

function sourcePageForExcerpt(rawText: string, excerpt: string): number | null {
  const marker = /--- PAGE (\d+) ---/g;
  const target = rawText.toLowerCase().indexOf(excerpt.toLowerCase());
  if (target < 0) return null;
  let page: number | null = null;
  for (const match of rawText.matchAll(marker)) {
    if ((match.index ?? 0) > target) break;
    page = Number(match[1]);
  }
  return page;
}

function hasPathValue(source: TenancyLegalIntelligence, path: string): boolean {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return Array.isArray(current) ? current.length > 0 : typeof current === 'number' ? current > 0 : Boolean(current);
}

function addRisk(
  risks: LegalRisk[], code: string, severity: LegalRiskSeverity, reason: string, recommendation: string,
  category = 'contract_completeness', sourcePage: number | null = null, sourceExcerpt = ''
): void {
  risks.push({ code, severity, category, reason, recommendation, source_page: sourcePage, source_excerpt: sourceExcerpt });
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
      category: String(candidate.category ?? 'contract_review').replace(/\s+/g, ' ').trim(),
      reason,
      recommendation: String(candidate.recommendation ?? 'Review this issue against the signed agreement.').replace(/\s+/g, ' ').trim(),
      source_page: Number.isInteger(candidate.source_page) && Number(candidate.source_page) > 0 ? Number(candidate.source_page) : null,
      source_excerpt: String(candidate.source_excerpt ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
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

function isPositiveMoney(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
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
  const aliases = kind === 'security' ? ['security deposit', 'earnest deposit'] : ['utility deposit', 'utilities deposit'];
  return findDepositRentalMultiple(text, aliases)?.months ?? null;
}

function findExplicitDepositAmount(rawText: string, aliases: string[]): { amount: number; page: number | null; excerpt: string } | null {
  const label = aliases.map(escapeRegExp).join('|');
  const labelPattern = new RegExp(`(?:${label})`, 'i');
  const amountPattern = /\b(?:RM|MYR)\s*([\d,]+(?:\.\d{1,2})?)\b/i;
  const noDepositPattern = /\b(?:no|nil|zero)\s+(?:security\s+|utility\s+|access\s+card\s+|car\s+park\s+|parking\s+|remote\s+control\s+)?deposit\b|\bdeposit\s*(?:is\s*)?(?:not\s+required|nil|zero)\b/i;
  const lines = rawText.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const labelMatch = line.match(labelPattern);
    if (!labelMatch || labelMatch.index === undefined) continue;
    const sameLineAmount = line.match(amountPattern);
    const nextLineAmount = !sameLineAmount && lines[index + 1]?.trim().match(amountPattern);
    const amountMatch = sameLineAmount ?? nextLineAmount;
    if (!amountMatch && !noDepositPattern.test(line)) continue;
    if (!amountMatch) {
      const source = findSourceExcerpt(rawText, new RegExp(escapeRegExp(line.trim()), 'i'));
      return { amount: 0, page: source.page, excerpt: source.excerpt };
    }
    const amount = Number(amountMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount < 0) continue;
    const excerpt = sameLineAmount ? line : `${line} ${lines[index + 1]}`;
    const source = findSourceExcerpt(rawText, new RegExp(escapeRegExp(excerpt.trim()), 'i'));
    return { amount: roundMoney(amount), page: source.page, excerpt: source.excerpt };
  }
  return null;
}

function findDepositRentalMultiple(rawText: string, aliases: string[]): { months: number; page: number | null; excerpt: string } | null {
  const label = aliases.map(escapeRegExp).join('|');
  const multiplier = '(?:half|0\\.5|one|two|three|four|five|six|seven|eight|nine|ten|twelve|\\d+(?:\\.\\d+)?)';
  const term = `${multiplier}\\s*(?:\\(\\s*\\d+(?:\\.\\d+)?\\s*\\))?\\s*months?\\b(?:\\'s|\\')?\\s*(?:of\\s*)?(?:the\\s*)?(?:monthly\\s*)?(?:rental|rent)`;
  const labelFirst = new RegExp(`(?:${label})[\\s\\S]{0,140}?${term}`, 'i');
  const termFirst = new RegExp(`${term}[\\s\\S]{0,90}?(?:${label})`, 'i');
  const match = rawText.match(labelFirst) ?? rawText.match(termFirst);
  if (!match) return null;
  const value = match[0].match(new RegExp(`\\b(${multiplier})\\s*(?:\\(\\s*\\d+(?:\\.\\d+)?\\s*\\))?\\s*months?\\b`, 'i'))?.[1]?.toLowerCase();
  if (!value) return null;
  const words: Record<string, number> = { half: 0.5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
  const months = words[value] ?? Number(value);
  if (!Number.isFinite(months) || months <= 0 || months > 24) return null;
  const source = findSourceExcerpt(rawText, new RegExp(escapeRegExp(match[0]), 'i'));
  return { months, page: source.page, excerpt: source.excerpt };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasConflictingDates(extraction: TenancyLegalIntelligence, rawText: string): boolean {
  const labelled = [...rawText.matchAll(/(?:commencement|start|expiry|expiration|end)\s+date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/gi)]
    .map((match) => normalizeDate(match[1])).filter(Boolean);
  return new Set(labelled).size > 2;
}

function hasInvalidTenancyPeriod(extraction: TenancyLegalIntelligence): boolean {
  const { commencement_date: start, expiry_date: end } = extraction.tenancy;
  return Boolean(start && end && new Date(`${end}T00:00:00Z`) <= new Date(`${start}T00:00:00Z`));
}

function isAmbiguousNoticePeriod(value: string): boolean {
  return !/\b\d+(?:\.\d+)?\s*(?:day|week|month|year)s?\b/i.test(value);
}

function findSourceExcerpt(rawText: string, pattern: RegExp): { page: number | null; excerpt: string } {
  const match = rawText.match(pattern);
  if (!match || match.index === undefined) return { page: null, excerpt: '' };
  const lineStart = rawText.lastIndexOf('\n', match.index) + 1;
  const lineEndIndex = rawText.indexOf('\n', match.index + match[0].length);
  const lineEnd = lineEndIndex < 0 ? rawText.length : lineEndIndex;
  const excerpt = rawText.slice(lineStart, lineEnd).replace(/\s+/g, ' ').trim().slice(0, 500);
  return { page: excerpt ? sourcePageForExcerpt(rawText, excerpt) : null, excerpt };
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatSummaryDate(value: string): string {
  return formatNexoraDate(value);
}

function normalizeContacts(value: ExtractedTenancyContact[] | undefined): ExtractedTenancyContact[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((contact) => {
    const sourceExcerpt = extractionText(contact.source_excerpt).slice(0, 500);
    const agentEvidence = Boolean(extractionText(contact.ren_number)) || /\b(?:agent|negotiator|real estate|property agency|ren\s*[:#-]?\s*\w+)/i.test(sourceExcerpt);
    const inferredRole = contact.role === 'agent' && /\bwitness\b/i.test(sourceExcerpt) && !agentEvidence ? 'witness' : contact.role;
    const normalized = {
      ...partyForContact(contact),
      role: ['tenant', 'landlord', 'witness', 'agent', 'law_firm'].includes(inferredRole) ? inferredRole : 'witness' as const,
      represents: ['tenant', 'landlord', 'both', 'neutral', 'unknown'].includes(contact.represents) ? contact.represents : 'unknown' as const,
      ren_number: normalizeIdentification(contact.ren_number).replace(/\s+/g, ''),
      source_page: Number.isInteger(contact.source_page) && Number(contact.source_page) > 0 ? Number(contact.source_page) : null,
      source_excerpt: sourceExcerpt,
      confidence: Math.max(0, Math.min(100, Number(contact.confidence) || 0))
    };
    if (!normalized.name && !normalized.company && !normalized.ic_passport && !normalized.company_number && !normalized.phone && !normalized.email) return [];
    const key = `${normalized.role}:${normalized.email || normalized.phone || normalized.ic_passport || normalized.company_number || normalized.name}`.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function partyForContact(value: Partial<LegalParty>): LegalParty {
  return {
    name: normalizePersonName(value.name), company: extractionText(value.company), ic_passport: normalizeIdentification(value.ic_passport).replace(/\s+/g, ''),
    identification_type: extractionText(value.identification_type), company_number: normalizeIdentification(value.company_number).replace(/\s+/g, ''),
    phone: normalizeMalaysianPhone(extractionText(value.phone)), email: normalizeEmail(extractionText(value.email)), correspondence_address: extractionText(value.correspondence_address)
  };
}

function normalizePayment(value: Partial<TenancyLegalIntelligence['payment']> | undefined): TenancyLegalIntelligence['payment'] {
  return {
    method: extractionText(value?.method), bank_name: extractionText(value?.bank_name), account_number: extractionText(value?.account_number).replace(/^.*?(?:account\s*(?:no|number)?\s*[:#-]?\s*)/i, '').replace(/\s+/g, ''),
    account_holder: normalizePersonName(value?.account_holder), late_payment_interest: normalizePercentages(extractionText(value?.late_payment_interest)), grace_period: normalizeNoticePeriod(extractionText(value?.grace_period))
  };
}

function normalizeParking(value: Partial<TenancyLegalIntelligence['parking']> | undefined): TenancyLegalIntelligence['parking'] {
  return { bays: extractionText(value?.bays), bay_numbers: extractionText(value?.bay_numbers), access_cards: extractionText(value?.access_cards), remote_controls: extractionText(value?.remote_controls), keys: extractionText(value?.keys) };
}

function extractionText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim() : '';
}

function normalizeClauseCoverage(value: Partial<TenancyLegalIntelligence['clause_coverage']> | undefined): TenancyLegalIntelligence['clause_coverage'] {
  const keys = ['pets', 'subletting', 'airbnb', 'illegal_business', 'termination', 'default', 'force_majeure', 'viewing_rights', 'landlord_access', 'deposit_refund', 'repairs', 'maintenance', 'insurance'] as const;
  return Object.fromEntries(keys.map((key) => [key, value?.[key] === true])) as TenancyLegalIntelligence['clause_coverage'];
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
