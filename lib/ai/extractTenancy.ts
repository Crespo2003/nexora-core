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
    monthly_rental: number;
    security_deposit: number;
    utility_deposit: number;
    access_card_deposit: number;
    car_park_deposit: number;
    holding_deposit?: number;
    booking_fee?: number;
    stamp_duty: number;
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
Extract tenant, landlord, witness, agent, and law-firm contacts into contacts. Include every stated name, IC/passport, company registration number, phone, email, correspondence address, stated role, source page, concise source excerpt, and confidence. Keep the person/company identity value separate from its label.
For tenant and landlord, extract identification_type, company_number, and correspondence_address as well as the core particulars.
Split the property into name, unit_number, street, postcode, city, state, country, and address. The address may retain the complete source address; never invent an address component.
For security, utility, access-card, car-park, holding deposits and booking fee, first preserve an explicit monetary amount. When no amount is written but the agreement explicitly gives a rental multiple, calculate it from monthly_rental. Recognize two (2) months rental, two months' rental, one month rental, half month rental, 0.5 month rental, equal to, and equivalent to. Do not calculate when the agreement does not clearly state a rental multiple.
Extract payment method, bank name, account number, account holder, rental due day, late-payment interest, grace period, renewal period, automatic renewal, holding deposit and booking fee.
For utilities record who pays or whether each is included/excluded for electricity/TNB, water, IWK, internet/WiFi, air-conditioning, maintenance fee, quit rent, and assessment.
For parking record bays, bay numbers, access cards, remote controls, and keys. Extract a structured inventory item list for furnished items such as beds, wardrobes, appliances, furniture, curtains, and water heaters.
Set every clause_coverage boolean to true only when a material clause is present. Cover pets, subletting, Airbnb/short stays, illegal business, termination, default, force majeure, viewing rights, landlord access, deposit refund, repairs, maintenance, and insurance.
Preserve material special clauses as concise complete statements.
Extract signatures, witnesses, stamp duty, inventory, restrictions, late-payment terms, termination, viewing rights, insurance, maintenance, access-card and car-park terms.
Identify legal and operational risks, including missing signatures, missing witnesses, missing party IC/passport details, missing stamp duty evidence, conflicting rental amounts or dates, potentially unlawful or unenforceable clauses, no renewal clause, no inspection clause, no termination clause, deposit mismatch, missing inventory, and missing maintenance terms.
Every risk must include a stable snake_case code, severity, evidence-based reason, and practical recommendation.
Return the canonical schema exactly. It has document, confidence, tenant, landlord, contacts, property, financial, tenancy, payment, utilities, parking, inventory, clause_coverage, legal, clauses, risks, and warnings. Do not add fields.
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
  if (monthlyRental <= 0) return extraction;

  const financial = { ...extraction.financial };
  const evidence = { ...extraction.field_evidence };
  const warnings = [...extraction.warnings];
  const deposits: Array<{ field: keyof Pick<TenancyLegalIntelligence['financial'], 'security_deposit' | 'utility_deposit' | 'access_card_deposit' | 'car_park_deposit'>; label: string; aliases: string[] }> = [
    { field: 'security_deposit', label: 'Security deposit', aliases: ['security deposit', 'earnest deposit'] },
    { field: 'utility_deposit', label: 'Utility deposit', aliases: ['utility deposit', 'utilities deposit'] },
    { field: 'access_card_deposit', label: 'Access card deposit', aliases: ['access card deposit', 'access deposit'] },
    { field: 'car_park_deposit', label: 'Car park deposit', aliases: ['car park deposit', 'parking deposit', 'remote control deposit', 'car park remote deposit'] }
  ];

  for (const deposit of deposits) {
    if (financial[deposit.field] > 0) continue;
    const explicit = findExplicitDepositAmount(rawText, deposit.aliases);
    if (explicit) {
      financial[deposit.field] = explicit.amount;
      evidence[`financial.${deposit.field}`] = { value: String(explicit.amount), confidence: 98, source_page: explicit.page, source_excerpt: explicit.excerpt };
      continue;
    }
    const multiple = findDepositRentalMultiple(rawText, deposit.aliases);
    if (multiple === null) continue;
    const amount = roundMoney(monthlyRental * multiple.months);
    financial[deposit.field] = amount;
    evidence[`financial.${deposit.field}`] = { value: String(amount), confidence: 88, source_page: multiple.page, source_excerpt: multiple.excerpt };
    warnings.push(`${deposit.label} was calculated from the stated ${multiple.months}-month rental multiple; verify the agreement wording.`);
  }
  return { ...extraction, financial, field_evidence: evidence, warnings: uniqueStrings(warnings) };
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
  if (new Set(rentalValues.map((value) => value.toFixed(2))).size > 1) {
    addRisk(risks, 'rental_inconsistency', 'high', 'Conflicting monthly rental amounts were detected.', 'Verify the operative rental amount across the body, schedules, and payment clauses.', 'financial');
    warnings.push('Conflicting monthly rental values require manual review.');
  }

  const expectedSecurityMonths = extractDepositMonths(rawText, 'security');
  if (expectedSecurityMonths !== null && extraction.financial.monthly_rental > 0) {
    const expected = extraction.financial.monthly_rental * expectedSecurityMonths;
    if (Math.abs(expected - extraction.financial.security_deposit) > 1) {
      const source = findDepositRentalMultiple(rawText, ['security deposit', 'earnest deposit']);
      addRisk(risks, 'security_deposit_mismatch', 'high', 'Requires Review: the extracted security deposit amount is preserved but conflicts with the stated rental-month multiple.', 'Reconcile the stated multiple and payable amount without overwriting the extracted value.', 'financial', source?.page ?? null, source?.excerpt ?? '');
      warnings.push('Requires Review: security deposit conflicts with the stated rental multiple.');
    }
  }
  const expectedUtilityMonths = extractDepositMonths(rawText, 'utilit');
  if (expectedUtilityMonths !== null && extraction.financial.monthly_rental > 0) {
    const expected = extraction.financial.monthly_rental * expectedUtilityMonths;
    if (Math.abs(expected - extraction.financial.utility_deposit) > 1) {
      const source = findDepositRentalMultiple(rawText, ['utility deposit', 'utilities deposit']);
      addRisk(risks, 'utility_deposit_mismatch', 'high', 'Requires Review: the extracted utility deposit amount is preserved but conflicts with the stated rental-month multiple.', 'Reconcile the stated multiple and payable amount without overwriting the extracted value.', 'financial', source?.page ?? null, source?.excerpt ?? '');
      warnings.push('Requires Review: utility deposit conflicts with the stated rental multiple.');
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
  if (isAmbiguousNoticePeriod(extraction.tenancy.notice_period)) addRisk(risks, 'ambiguous_notice_period', 'medium', 'The notice period is missing or does not state a clear number and time unit.', 'Confirm the required notice duration and whether it is measured in days or months.', 'termination');
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
    money.monthly_rental > 0 ? `${formatMYR(money.monthly_rental)} monthly rental` : '',
    money.security_deposit > 0 ? `${formatMYR(money.security_deposit)} security deposit` : '',
    money.utility_deposit > 0 ? `${formatMYR(money.utility_deposit)} utility deposit` : ''
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
    contacts: source.contacts.map((contact) => ({ ...mapParty(contact), role: contact.role, represents: contact.represents, source_page: contact.source_page, source_excerpt: contact.source_excerpt, confidence: Math.round(contact.confidence * 100) })),
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
      monthly_rental: source.financial.monthly_rental ?? 0,
      security_deposit: source.financial.security_deposit ?? 0,
      utility_deposit: source.financial.utility_deposit ?? 0,
      access_card_deposit: source.financial.access_card_deposit ?? 0,
      car_park_deposit: source.financial.car_park_deposit ?? 0,
      holding_deposit: source.financial.holding_deposit ?? 0,
      booking_fee: source.financial.booking_fee ?? 0,
      stamp_duty: source.financial.stamp_duty ?? 0
    },
    tenancy: { ...source.tenancy, payment_due_day: source.tenancy.payment_due_day ?? '' },
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
  const money = (value: unknown) => {
    const amount = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
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
    tenancy: {
      commencement_date: normalizeDate(text(source.tenancy?.commencement_date)),
      expiry_date: normalizeDate(text(source.tenancy?.expiry_date)),
      renewal_option: normalizePercentages(text(source.tenancy?.renewal_option)), renewal_period: normalizeNoticePeriod(text(source.tenancy?.renewal_period)),
      automatic_renewal: text(source.tenancy?.automatic_renewal), notice_period: normalizeNoticePeriod(text(source.tenancy?.notice_period)),
      payment_due_day: normalizePaymentDay(text(source.tenancy?.payment_due_day))
    },
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
  const amountPattern = /\\b(?:RM|MYR)\\s*([\\d,]+(?:\\.\\d{1,2})?)\\b/i;
  const lines = rawText.split(/\\r?\\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const labelMatch = line.match(labelPattern);
    if (!labelMatch || labelMatch.index === undefined) continue;
    const sameLineAmount = line.match(amountPattern);
    const nextLineAmount = !sameLineAmount && lines[index + 1]?.trim().match(amountPattern);
    const amountMatch = sameLineAmount ?? nextLineAmount;
    if (!amountMatch) continue;
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
    const normalized = {
      ...partyForContact(contact),
      role: ['tenant', 'landlord', 'witness', 'agent', 'law_firm'].includes(contact.role) ? contact.role : 'witness' as const,
      represents: ['tenant', 'landlord', 'both', 'neutral', 'unknown'].includes(contact.represents) ? contact.represents : 'unknown' as const,
      source_page: Number.isInteger(contact.source_page) && Number(contact.source_page) > 0 ? Number(contact.source_page) : null,
      source_excerpt: extractionText(contact.source_excerpt).slice(0, 500),
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
