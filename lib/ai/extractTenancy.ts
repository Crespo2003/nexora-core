import type { OcrProvider } from '../ocr/ocrProvider';
import { extractDocumentText } from '../documents/extractText';

export type LegalParty = {
  name: string;
  company: string;
  ic_passport: string;
  phone: string;
  email: string;
};

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
  special_clauses: string[];
  risks: string[];
  warnings: string[];
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

type ResponsesPayload = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string; type?: string; refusal?: string }> }>;
  error?: { message?: string };
};

type ExtractTenancyOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  ocrProvider?: OcrProvider;
  maxChunkCharacters?: number;
};

const stringSchema = { type: 'string' } as const;
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

export const tenancyLegalIntelligenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'document_type', 'confidence', 'tenant', 'landlord', 'property', 'financial',
    'tenancy', 'utilities', 'special_clauses', 'risks', 'warnings'
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
    special_clauses: { type: 'array', items: stringSchema },
    risks: { type: 'array', items: stringSchema },
    warnings: { type: 'array', items: stringSchema }
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
Identify legal and operational risks, including missing witnesses, missing stamp duty evidence, conflicting rental amounts, potentially unlawful or unenforceable clauses, no renewal clause, no inspection clause, no termination clause, deposit mismatch, missing landlord details, and missing tenant details.
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

  const model = options.model ?? process.env.OPENAI_TENANCY_MODEL ?? 'gpt-5.4';
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

  if (!/\bwitness(?:es|ed)?\b|in the presence of|saksi/.test(text)) risks.push('Missing witness or witnessing provision.');
  if (!/stamp duty|stamping|duly stamped|hasil|lhdn|setem/.test(text) && extraction.financial.stamp_duty === 0) {
    risks.push('Missing stamp duty amount or evidence of stamping.');
  }
  if (!/renew|renewal|pembaharuan/.test(text) && !extraction.tenancy.renewal_option) risks.push('No renewal clause detected.');
  if (!/inspect|inspection|viewing|memeriksa|pemeriksaan/.test(text)) risks.push('No inspection or viewing clause detected.');
  if (!/terminat|termination|determin|penamatan/.test(text)) risks.push('No termination clause detected.');
  if (!hasPartyDetails(extraction.landlord)) risks.push('Missing landlord details.');
  if (!hasPartyDetails(extraction.tenant)) risks.push('Missing tenant details.');

  const rentalValues = extractRentalAmounts(rawText);
  if (new Set(rentalValues.map((value) => value.toFixed(2))).size > 1) risks.push('Conflicting monthly rental amounts detected; verify the operative rental clause.');

  const expectedSecurityMonths = extractDepositMonths(rawText, 'security');
  if (expectedSecurityMonths !== null && extraction.financial.monthly_rental > 0) {
    const expected = extraction.financial.monthly_rental * expectedSecurityMonths;
    if (Math.abs(expected - extraction.financial.security_deposit) > 1) risks.push('Security deposit amount does not match the stated rental-month multiple.');
  }
  const expectedUtilityMonths = extractDepositMonths(rawText, 'utilit');
  if (expectedUtilityMonths !== null && extraction.financial.monthly_rental > 0) {
    const expected = extraction.financial.monthly_rental * expectedUtilityMonths;
    if (Math.abs(expected - extraction.financial.utility_deposit) > 1) risks.push('Utility deposit amount does not match the stated rental-month multiple.');
  }

  if (/evict.{0,80}without (?:a )?court|enter.{0,80}without (?:prior )?notice|forfeit.{0,80}without notice|waive.{0,80}(?:legal|statutory) rights?/.test(text)) {
    risks.push('Potentially unlawful or unenforceable clause detected; obtain Malaysian legal review.');
  }
  if (!extraction.tenancy.commencement_date) warnings.push('Commencement date was not reliably detected.');
  if (!extraction.tenancy.expiry_date) warnings.push('Expiry date was not reliably detected.');
  if (extraction.confidence < 0.75) warnings.push('Overall extraction confidence is below 75%; verify against the source document.');

  return { ...extraction, risks: uniqueStrings(risks), warnings: uniqueStrings(warnings) };
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
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        store: false,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: extractionInstructions }] },
          { role: 'user', content: [{ type: 'input_text', text: input.prompt }] }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'malaysian_tenancy_legal_intelligence',
            strict: true,
            schema: tenancyLegalIntelligenceSchema
          }
        },
        max_output_tokens: 8_000
      }),
      signal: AbortSignal.timeout(120_000)
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    throw new TenancyExtractionError(timeout ? 'openai-timeout' : 'openai-request-failed');
  }

  const payload = await response.json() as ResponsesPayload;
  if (!response.ok) throw new TenancyExtractionError(`openai-response-${response.status}`);
  const refusal = (payload.output ?? []).flatMap((item) => item.content ?? []).find((item) => item.refusal)?.refusal;
  if (refusal) throw new TenancyExtractionError('openai-refused-extraction');
  const outputText = payload.output_text ?? (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' || Boolean(item.text))
    .map((item) => item.text ?? '')
    .join('')
    .trim();
  if (!outputText) throw new TenancyExtractionError('openai-empty-extraction');

  try {
    return validateExtractionShape(JSON.parse(outputText));
  } catch {
    throw new TenancyExtractionError('openai-invalid-extraction');
  }
}

function validateExtractionShape(value: unknown): TenancyLegalIntelligence {
  if (!value || typeof value !== 'object') throw new Error('invalid-object');
  const candidate = value as Partial<TenancyLegalIntelligence>;
  if (!candidate.tenant || !candidate.landlord || !candidate.property || !candidate.financial || !candidate.tenancy || !candidate.utilities) {
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
    name: text(value?.name), company: text(value?.company), ic_passport: text(value?.ic_passport),
    phone: text(value?.phone), email: text(value?.email)
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
    special_clauses: uniqueStrings(source.special_clauses ?? []),
    risks: uniqueStrings(source.risks ?? []),
    warnings: uniqueStrings(source.warnings ?? [])
  };
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
