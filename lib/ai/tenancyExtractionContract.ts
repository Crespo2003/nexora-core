import { OpenAiClientError, type OpenAiFailureCode } from './openAiClient';

export type CanonicalTenancyRisk = {
  code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  reason: string;
  recommendation: string;
};

export type CanonicalTenancyParty = {
  name: string;
  company: string;
  identification: string;
  identification_type: string;
  company_number: string;
  phone: string;
  email: string;
  correspondence_address: string;
};

export type CanonicalTenancyContact = CanonicalTenancyParty & {
  role: 'tenant' | 'landlord' | 'witness' | 'agent' | 'law_firm';
  represents: 'tenant' | 'landlord' | 'both' | 'neutral' | 'unknown';
  source_page: number | null;
  source_excerpt: string;
  confidence: number;
};

/**
 * The one model-facing contract. UI, persistence, and legal enrichment consume
 * the normalized projection of this object rather than a provider-specific payload.
 */
export type CanonicalTenancyExtraction = {
  document: { type: string; language: string; summary: string };
  confidence: number;
  tenant: CanonicalTenancyParty;
  landlord: CanonicalTenancyParty;
  contacts: CanonicalTenancyContact[];
  property: {
    name: string; unit_number: string; address: string; street: string; postcode: string; city: string; state: string; country: string;
    property_type: string; build_up: string; land_area: string; car_parks: string;
  };
  financial: {
    monthly_rental: number | null;
    security_deposit: number | null;
    utility_deposit: number | null;
    access_card_deposit: number | null;
    car_park_deposit: number | null;
    holding_deposit: number | null;
    booking_fee: number | null;
    stamp_duty: number | null;
  };
  tenancy: {
    commencement_date: string; expiry_date: string; renewal_option: string; renewal_period: string; automatic_renewal: string;
    notice_period: string; payment_due_day: string | null;
  };
  payment: { method: string; bank_name: string; account_number: string; account_holder: string; late_payment_interest: string; grace_period: string };
  utilities: { tnb: string; water: string; iwk: string; wifi: string; aircond: string; maintenance_fee: string; quit_rent: string; assessment: string };
  parking: { bays: string; bay_numbers: string; access_cards: string; remote_controls: string; keys: string };
  inventory: { items: string[]; furnished: string };
  clause_coverage: {
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
  clauses: string[];
  risks: CanonicalTenancyRisk[];
  warnings: string[];
};

export type OpenAiResponseDiagnostics = {
  responseStatus?: string;
  incompleteReason?: string;
  outputItemTypes?: string[];
  outputTextLength?: number;
  parseResult?: string;
  validationIssuePaths?: string[];
};

export type OpenAiTenancyResponseFailureCode = Extract<OpenAiFailureCode,
  'openai_refusal' | 'openai_incomplete' | 'openai_empty_response' | 'openai_malformed_json' |
  'openai_schema_mismatch' | 'openai_truncated' | 'openai_request_failed'>;

export class OpenAiTenancyResponseError extends OpenAiClientError {
  constructor(
    code: OpenAiTenancyResponseFailureCode,
    public readonly diagnostics: OpenAiResponseDiagnostics = {}
  ) {
    super(code);
    this.name = 'OpenAiTenancyResponseError';
  }
}

const string = { type: 'string' } as const;
const nullableMoney = { type: ['number', 'null'], minimum: 0 } as const;
const party = {
  type: 'object', additionalProperties: false,
  required: ['name', 'company', 'identification', 'identification_type', 'company_number', 'phone', 'email', 'correspondence_address'],
  properties: {
    name: string, company: string, identification: string, identification_type: string, company_number: string,
    phone: string, email: string, correspondence_address: string
  }
} as const;
const contact = {
  type: 'object', additionalProperties: false,
  required: ['role', 'represents', 'name', 'company', 'identification', 'identification_type', 'company_number', 'phone', 'email', 'correspondence_address', 'source_page', 'source_excerpt', 'confidence'],
  properties: {
    role: { type: 'string', enum: ['tenant', 'landlord', 'witness', 'agent', 'law_firm'] },
    represents: { type: 'string', enum: ['tenant', 'landlord', 'both', 'neutral', 'unknown'] },
    name: string, company: string, identification: string, identification_type: string, company_number: string,
    phone: string, email: string, correspondence_address: string,
    source_page: { type: ['integer', 'null'], minimum: 1 }, source_excerpt: string,
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  }
} as const;
const clausePresence = {
  type: 'object', additionalProperties: false,
  required: ['pets', 'subletting', 'airbnb', 'illegal_business', 'termination', 'default', 'force_majeure', 'viewing_rights', 'landlord_access', 'deposit_refund', 'repairs', 'maintenance', 'insurance'],
  properties: {
    pets: { type: 'boolean' }, subletting: { type: 'boolean' }, airbnb: { type: 'boolean' }, illegal_business: { type: 'boolean' },
    termination: { type: 'boolean' }, default: { type: 'boolean' }, force_majeure: { type: 'boolean' }, viewing_rights: { type: 'boolean' },
    landlord_access: { type: 'boolean' }, deposit_refund: { type: 'boolean' }, repairs: { type: 'boolean' }, maintenance: { type: 'boolean' }, insurance: { type: 'boolean' }
  }
} as const;
const risk = {
  type: 'object', additionalProperties: false,
  required: ['code', 'severity', 'category', 'reason', 'recommendation'],
  properties: {
    code: string,
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    category: string,
    reason: string,
    recommendation: string
  }
} as const;

export const canonicalTenancyExtractionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['document', 'confidence', 'tenant', 'landlord', 'contacts', 'property', 'financial', 'tenancy', 'payment', 'utilities', 'parking', 'inventory', 'clause_coverage', 'legal', 'clauses', 'risks', 'warnings'],
  properties: {
    document: {
      type: 'object', additionalProperties: false,
      required: ['type', 'language', 'summary'],
      properties: { type: string, language: string, summary: string }
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    tenant: party,
    landlord: party,
    contacts: { type: 'array', items: contact },
    property: {
      type: 'object', additionalProperties: false,
      required: ['name', 'unit_number', 'address', 'street', 'postcode', 'city', 'state', 'country', 'property_type', 'build_up', 'land_area', 'car_parks'],
      properties: {
        name: string, unit_number: string, address: string, street: string, postcode: string, city: string, state: string, country: string,
        property_type: string, build_up: string, land_area: string, car_parks: string
      }
    },
    financial: {
      type: 'object', additionalProperties: false,
      required: ['monthly_rental', 'security_deposit', 'utility_deposit', 'access_card_deposit', 'car_park_deposit', 'holding_deposit', 'booking_fee', 'stamp_duty'],
      properties: {
        monthly_rental: nullableMoney, security_deposit: nullableMoney, utility_deposit: nullableMoney,
        access_card_deposit: nullableMoney, car_park_deposit: nullableMoney, holding_deposit: nullableMoney,
        booking_fee: nullableMoney, stamp_duty: nullableMoney
      }
    },
    tenancy: {
      type: 'object', additionalProperties: false,
      required: ['commencement_date', 'expiry_date', 'renewal_option', 'renewal_period', 'automatic_renewal', 'notice_period', 'payment_due_day'],
      properties: {
        commencement_date: string, expiry_date: string, renewal_option: string, renewal_period: string, automatic_renewal: string,
        notice_period: string, payment_due_day: { type: ['string', 'null'] }
      }
    },
    payment: {
      type: 'object', additionalProperties: false,
      required: ['method', 'bank_name', 'account_number', 'account_holder', 'late_payment_interest', 'grace_period'],
      properties: { method: string, bank_name: string, account_number: string, account_holder: string, late_payment_interest: string, grace_period: string }
    },
    utilities: {
      type: 'object', additionalProperties: false,
      required: ['tnb', 'water', 'iwk', 'wifi', 'aircond', 'maintenance_fee', 'quit_rent', 'assessment'],
      properties: { tnb: string, water: string, iwk: string, wifi: string, aircond: string, maintenance_fee: string, quit_rent: string, assessment: string }
    },
    parking: {
      type: 'object', additionalProperties: false,
      required: ['bays', 'bay_numbers', 'access_cards', 'remote_controls', 'keys'],
      properties: { bays: string, bay_numbers: string, access_cards: string, remote_controls: string, keys: string }
    },
    inventory: {
      type: 'object', additionalProperties: false,
      required: ['items', 'furnished'],
      properties: { items: { type: 'array', items: string }, furnished: string }
    },
    clause_coverage: clausePresence,
    legal: {
      type: 'object', additionalProperties: false,
      required: ['signatures', 'witnesses', 'stamp_duty', 'inventory', 'restrictions', 'late_payment', 'termination', 'viewing_rights', 'insurance', 'maintenance', 'access_card', 'car_park'],
      properties: {
        signatures: string, witnesses: string, stamp_duty: string, inventory: string, restrictions: { type: 'array', items: string },
        late_payment: string, termination: string, viewing_rights: string, insurance: string, maintenance: string, access_card: string, car_park: string
      }
    },
    clauses: { type: 'array', items: string },
    risks: { type: 'array', items: risk },
    warnings: { type: 'array', items: string }
  }
} as const;

type ResponsePayload = {
  status?: string;
  incomplete_details?: { reason?: string | null } | null;
  output_text?: unknown;
  output?: Array<{ type?: unknown; content?: Array<{ type?: unknown; text?: unknown; refusal?: unknown }> }>;
  error?: unknown;
};

export function parseOpenAITenancyResponse(response: unknown): CanonicalTenancyExtraction {
  const payload = asObject(response) as ResponsePayload | null;
  if (!payload || payload.error) throw new OpenAiTenancyResponseError('openai_request_failed');

  const diagnostics = responseDiagnostics(payload);
  if (payload.status === 'incomplete') {
    throw new OpenAiTenancyResponseError(
      payload.incomplete_details?.reason === 'max_output_tokens' ? 'openai_truncated' : 'openai_incomplete',
      diagnostics
    );
  }
  if (payload.status && payload.status !== 'completed') throw new OpenAiTenancyResponseError('openai_incomplete', diagnostics);

  const refusal = (payload.output ?? []).flatMap((item) => item.content ?? [])
    .find((item) => typeof item.refusal === 'string' && item.refusal.trim())?.refusal;
  if (refusal) throw new OpenAiTenancyResponseError('openai_refusal', { ...diagnostics, parseResult: 'refusal' });

  const raw = typeof payload.output_text === 'string' && payload.output_text.trim()
    ? payload.output_text
    : (payload.output ?? []).flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
      .map((item) => item.text as string).join('');
  const outputText = unwrapSingleJsonFence(raw).trim();
  const withLength = { ...diagnostics, outputTextLength: outputText.length };
  if (!outputText) throw new OpenAiTenancyResponseError('openai_empty_response', { ...withLength, parseResult: 'empty' });

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new OpenAiTenancyResponseError('openai_malformed_json', { ...withLength, parseResult: 'malformed_json' });
  }

  const rawObject = asObject(parsed);
  // Older stored extractions predate the extended intelligence sections. Keep
  // those records readable; normalization supplies empty extended sections.
  const missingSections = ['document', 'tenant', 'landlord', 'property', 'financial', 'tenancy', 'utilities', 'legal']
    .filter((key) => !asObject(rawObject?.[key]));
  if (!rawObject || missingSections.length) {
    throw new OpenAiTenancyResponseError('openai_schema_mismatch', {
      ...withLength,
      parseResult: 'schema_mismatch',
      validationIssuePaths: missingSections.length ? missingSections : ['root']
    });
  }
  const rawShapeIssues = validateRawValueShapes(rawObject);
  if (rawShapeIssues.length) {
    throw new OpenAiTenancyResponseError('openai_schema_mismatch', {
      ...withLength,
      parseResult: 'schema_mismatch',
      validationIssuePaths: rawShapeIssues
    });
  }
  const normalized = normalizeCanonicalTenancyExtraction(parsed);
  const validationIssuePaths = validateCanonicalTenancyExtraction(normalized);
  if (validationIssuePaths.length) {
    throw new OpenAiTenancyResponseError('openai_schema_mismatch', {
      ...withLength,
      parseResult: 'schema_mismatch',
      validationIssuePaths
    });
  }
  return normalized;
}

/** Normalizes documented optional omissions without inventing agreement facts. */
export function normalizeCanonicalTenancyExtraction(value: unknown): CanonicalTenancyExtraction {
  const source = asObject(value) ?? {};
  const object = (key: string) => asObject(source[key]) ?? {};
  const strings = (sourceValue: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, normalizeText(sourceValue[key])])) as Record<string, string>;
  const document = strings(object('document'), ['type', 'language', 'summary']);
  const normalizeParty = (value: Record<string, unknown>) => ({
    ...strings(value, ['name', 'company', 'identification', 'identification_type', 'company_number', 'phone', 'email', 'correspondence_address']),
    name: normalizePersonName(value.name),
    identification: normalizeIdentification(value.identification),
    company_number: normalizeIdentification(value.company_number),
    correspondence_address: normalizeLabelledValue(value.correspondence_address)
  });
  const tenant = normalizeParty(object('tenant'));
  const landlord = normalizeParty(object('landlord'));
  const property = strings(object('property'), ['name', 'unit_number', 'address', 'street', 'postcode', 'city', 'state', 'country', 'property_type', 'build_up', 'land_area', 'car_parks']);
  const contacts = normalizeContacts(source.contacts);
  const tenancySource = object('tenancy');
  const tenancy = {
    commencement_date: normalizeDate(normalizeText(tenancySource.commencement_date)),
    expiry_date: normalizeDate(normalizeText(tenancySource.expiry_date)),
    renewal_option: normalizeText(tenancySource.renewal_option),
    renewal_period: normalizeText(tenancySource.renewal_period),
    automatic_renewal: normalizeText(tenancySource.automatic_renewal),
    notice_period: normalizeText(tenancySource.notice_period),
    payment_due_day: tenancySource.payment_due_day === null || tenancySource.payment_due_day === undefined || tenancySource.payment_due_day === '' ? null : normalizeText(tenancySource.payment_due_day)
  };
  const payment = normalizePayment(object('payment'));
  const utilities = strings(object('utilities'), ['tnb', 'water', 'iwk', 'wifi', 'aircond', 'maintenance_fee', 'quit_rent', 'assessment']);
  const parking = strings(object('parking'), ['bays', 'bay_numbers', 'access_cards', 'remote_controls', 'keys']);
  const inventorySource = object('inventory');
  const inventory = { items: normalizeStringArray(inventorySource.items), furnished: normalizeText(inventorySource.furnished) };
  const clauseCoverage = normalizeClauseCoverage(object('clause_coverage'));
  const legalSource = object('legal');
  const legal = {
    ...strings(legalSource, ['signatures', 'witnesses', 'stamp_duty', 'inventory', 'late_payment', 'termination', 'viewing_rights', 'insurance', 'maintenance', 'access_card', 'car_park']),
    restrictions: normalizeStringArray(legalSource.restrictions)
  } as CanonicalTenancyExtraction['legal'];
  const financialSource = object('financial');
  const monthlyRental = normalizeMoney(financialSource.monthly_rental);
  const financial = {
    monthly_rental: monthlyRental,
    security_deposit: normalizeMoney(financialSource.security_deposit, monthlyRental),
    utility_deposit: normalizeMoney(financialSource.utility_deposit, monthlyRental),
    access_card_deposit: normalizeMoney(financialSource.access_card_deposit, monthlyRental),
    car_park_deposit: normalizeMoney(financialSource.car_park_deposit, monthlyRental),
    holding_deposit: normalizeMoney(financialSource.holding_deposit, monthlyRental),
    booking_fee: normalizeMoney(financialSource.booking_fee, monthlyRental),
    stamp_duty: normalizeMoney(financialSource.stamp_duty, monthlyRental)
  };

  return {
    document: document as CanonicalTenancyExtraction['document'],
    confidence: normalizeConfidence(source.confidence),
    tenant: tenant as CanonicalTenancyExtraction['tenant'],
    landlord: landlord as CanonicalTenancyExtraction['landlord'],
    contacts,
    property: property as CanonicalTenancyExtraction['property'],
    financial,
    tenancy,
    payment,
    utilities: utilities as CanonicalTenancyExtraction['utilities'],
    parking: parking as CanonicalTenancyExtraction['parking'],
    inventory,
    clause_coverage: clauseCoverage,
    legal,
    clauses: normalizeStringArray(source.clauses),
    risks: normalizeRisks(source.risks),
    warnings: normalizeStringArray(source.warnings)
  };
}

/** Removes document labels while retaining the actual NRIC, passport, or registration value. */
export function normalizeIdentification(value: unknown): string {
  return normalizeText(value)
    .replace(/^(?:(?:nric|ic|passport|company|registration)\s*(?:no|number)?|name|date)\s*[:#-]?\s*/i, '')
    .trim();
}

/** Preserves normal multi-word names while repairing obvious OCR letter spacing such as "A N XIN". */
export function normalizePersonName(value: unknown): string {
  const tokens = normalizeLabelledValue(value).split(/\s+/).filter(Boolean);
  const normalized: string[] = [];
  let initials = '';
  const flush = () => { if (initials) normalized.push(initials); initials = ''; };
  for (const token of tokens) {
    const clean = token.replace(/[^\p{L}]/gu, '');
    if (/^\p{L}$/u.test(clean)) initials += clean;
    else { flush(); normalized.push(token); }
  }
  flush();
  return normalized.join(' ').replace(/\s+/g, ' ').trim();
}

export function normalizeLabelledValue(value: unknown): string {
  return normalizeText(value)
    .replace(/^(?:(?:nric|ic|passport|company|registration|account|bank)\s*(?:no|number)?|name|date|address)\s*[:#-]?\s*/i, '')
    .trim();
}

function normalizeContacts(value: unknown): CanonicalTenancyContact[] {
  if (!Array.isArray(value)) return [];
  const supportedRoles = ['tenant', 'landlord', 'witness', 'agent', 'law_firm'] as const;
  const supportedRepresentation = ['tenant', 'landlord', 'both', 'neutral', 'unknown'] as const;
  return value.flatMap((item) => {
    const source = asObject(item);
    if (!source) return [];
    const role = normalizeText(source.role).toLowerCase();
    if (!supportedRoles.includes(role as typeof supportedRoles[number])) return [];
    const represents = normalizeText(source.represents).toLowerCase();
    const party = {
      name: normalizePersonName(source.name),
      company: normalizeText(source.company),
      identification: normalizeIdentification(source.identification),
      identification_type: normalizeText(source.identification_type),
      company_number: normalizeIdentification(source.company_number),
      phone: normalizeText(source.phone),
      email: normalizeText(source.email).toLowerCase(),
      correspondence_address: normalizeLabelledValue(source.correspondence_address)
    };
    if (!party.name && !party.company && !party.identification && !party.phone && !party.email) return [];
    const sourcePage = Number(source.source_page);
    return [{
      role: role as CanonicalTenancyContact['role'],
      represents: supportedRepresentation.includes(represents as typeof supportedRepresentation[number])
        ? represents as CanonicalTenancyContact['represents'] : 'unknown',
      ...party,
      source_page: Number.isInteger(sourcePage) && sourcePage > 0 ? sourcePage : null,
      source_excerpt: normalizeText(source.source_excerpt).slice(0, 500),
      confidence: normalizeConfidence(source.confidence)
    }];
  });
}

function normalizePayment(value: Record<string, unknown>): CanonicalTenancyExtraction['payment'] {
  return {
    method: normalizeText(value.method),
    bank_name: normalizeText(value.bank_name),
    account_number: normalizeLabelledValue(value.account_number).replace(/\s+/g, ''),
    account_holder: normalizePersonName(value.account_holder),
    late_payment_interest: normalizeText(value.late_payment_interest),
    grace_period: normalizeText(value.grace_period)
  };
}

function normalizeClauseCoverage(value: Record<string, unknown>): CanonicalTenancyExtraction['clause_coverage'] {
  const keys = ['pets', 'subletting', 'airbnb', 'illegal_business', 'termination', 'default', 'force_majeure', 'viewing_rights', 'landlord_access', 'deposit_refund', 'repairs', 'maintenance', 'insurance'] as const;
  return Object.fromEntries(keys.map((key) => [key, value[key] === true])) as CanonicalTenancyExtraction['clause_coverage'];
}

export function validateCanonicalTenancyExtraction(value: CanonicalTenancyExtraction): string[] {
  const issues: string[] = [];
  const objectPaths = ['document', 'tenant', 'landlord', 'property', 'financial', 'tenancy', 'payment', 'utilities', 'parking', 'inventory', 'clause_coverage', 'legal'] as const;
  for (const path of objectPaths) if (!value[path] || typeof value[path] !== 'object') issues.push(path);
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) issues.push('confidence');
  for (const [key, amount] of Object.entries(value.financial)) {
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) issues.push(`financial.${key}`);
  }
  if (!Array.isArray(value.clauses)) issues.push('clauses');
  if (!Array.isArray(value.contacts)) issues.push('contacts');
  if (!Array.isArray(value.risks)) issues.push('risks');
  if (!Array.isArray(value.warnings)) issues.push('warnings');
  for (const [index, item] of value.risks.entries()) {
    if (!item.code || !item.reason || !item.recommendation || !['low', 'medium', 'high', 'critical'].includes(item.severity)) issues.push(`risks.${index}`);
  }
  return issues;
}

export function responseDiagnostics(response: unknown): OpenAiResponseDiagnostics {
  const payload = asObject(response) as ResponsePayload | null;
  if (!payload) return {};
  const content = (payload.output ?? []).flatMap((item) => item.content ?? []);
  const rawText = typeof payload.output_text === 'string' ? payload.output_text : content
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string').map((item) => item.text as string).join('');
  return {
    responseStatus: typeof payload.status === 'string' ? payload.status : undefined,
    incompleteReason: typeof payload.incomplete_details?.reason === 'string' ? payload.incomplete_details.reason : undefined,
    outputItemTypes: content.map((item) => typeof item.type === 'string' ? item.type : 'unknown'),
    outputTextLength: rawText.trim().length
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validateRawValueShapes(value: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const textFields: Record<string, readonly string[]> = {
    document: ['type', 'language', 'summary'],
    tenant: ['name', 'company', 'identification', 'identification_type', 'company_number', 'phone', 'email', 'correspondence_address'],
    landlord: ['name', 'company', 'identification', 'identification_type', 'company_number', 'phone', 'email', 'correspondence_address'],
    property: ['name', 'unit_number', 'address', 'street', 'postcode', 'city', 'state', 'country', 'property_type', 'build_up', 'land_area', 'car_parks'],
    tenancy: ['commencement_date', 'expiry_date', 'renewal_option', 'renewal_period', 'automatic_renewal', 'notice_period', 'payment_due_day'],
    payment: ['method', 'bank_name', 'account_number', 'account_holder', 'late_payment_interest', 'grace_period'],
    utilities: ['tnb', 'water', 'iwk', 'wifi', 'aircond', 'maintenance_fee', 'quit_rent', 'assessment'],
    parking: ['bays', 'bay_numbers', 'access_cards', 'remote_controls', 'keys'],
    legal: ['signatures', 'witnesses', 'stamp_duty', 'inventory', 'late_payment', 'termination', 'viewing_rights', 'insurance', 'maintenance', 'access_card', 'car_park']
  };
  for (const [section, fields] of Object.entries(textFields)) {
    const object = asObject(value[section]) ?? {};
    for (const field of fields) {
      const item = object[field];
      if (item !== undefined && item !== null && typeof item !== 'string' && typeof item !== 'number') issues.push(`${section}.${field}`);
    }
  }
  const financial = asObject(value.financial) ?? {};
  for (const field of ['monthly_rental', 'security_deposit', 'utility_deposit', 'access_card_deposit', 'car_park_deposit', 'holding_deposit', 'booking_fee', 'stamp_duty']) {
    const item = financial[field];
    if (item !== undefined && item !== null && typeof item !== 'string' && typeof item !== 'number') issues.push(`financial.${field}`);
  }
  if (value.confidence !== undefined && typeof value.confidence !== 'string' && typeof value.confidence !== 'number') issues.push('confidence');
  for (const field of ['contacts', 'clauses', 'risks', 'warnings']) if (value[field] !== undefined && !Array.isArray(value[field])) issues.push(field);
  const legal = asObject(value.legal) ?? {};
  if (legal.restrictions !== undefined && !Array.isArray(legal.restrictions)) issues.push('legal.restrictions');
  const inventory = asObject(value.inventory) ?? {};
  if (inventory.items !== undefined && !Array.isArray(inventory.items)) issues.push('inventory.items');
  const coverage = asObject(value.clause_coverage) ?? {};
  for (const field of ['pets', 'subletting', 'airbnb', 'illegal_business', 'termination', 'default', 'force_majeure', 'viewing_rights', 'landlord_access', 'deposit_refund', 'repairs', 'maintenance', 'insurance']) {
    if (coverage[field] !== undefined && typeof coverage[field] !== 'boolean') issues.push(`clause_coverage.${field}`);
  }
  return issues;
}

function unwrapSingleJsonFence(value: string): string {
  const match = value.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : value;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeText).filter(Boolean).map((item) => item.toLowerCase()))]
    .map((lower) => value.map(normalizeText).find((item) => item.toLowerCase() === lower) as string);
}

function normalizeRisks(value: unknown): CanonicalTenancyRisk[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const risk = asObject(item);
    if (!risk) return [];
    const severity = normalizeText(risk.severity).toLowerCase();
    return [{
      code: normalizeText(risk.code).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      severity: ['low', 'medium', 'high', 'critical'].includes(severity) ? severity as CanonicalTenancyRisk['severity'] : 'medium',
      category: normalizeText(risk.category),
      reason: normalizeText(risk.reason),
      recommendation: normalizeText(risk.recommendation)
    }];
  });
}

function normalizeMoney(value: unknown, monthlyRental?: number | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? roundMoney(value) : null;
  const text = normalizeNoticeText(normalizeText(value));
  if (!text || /^(?:n\/?a|unknown|not stated|nil)$/i.test(text)) return null;
  const explicit = text.match(/\b(?:RM|MYR)\s*([\d,]+(?:\.\d{1,2})?)\b/i);
  if (explicit) {
    const amount = Number(explicit[1].replace(/,/g, ''));
    return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
  }
  const numeric = text.replace(/,/g, '');
  if (/^\d+(?:\.\d{1,2})?$/.test(numeric)) {
    const amount = Number(numeric);
    return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
  }
  if (monthlyRental === null || monthlyRental === undefined) return null;
  const multiplier = text.match(/\b(half|0\.5|one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d+(?:\.\d+)?)\s*(?:\(\s*\d+(?:\.\d+)?\s*\))?\s*months?(?:'s|')?\s*(?:of\s*)?(?:the\s*)?(?:monthly\s*)?(?:rental|rent|utilities?\s+deposit)\b/i);
  if (!multiplier) return null;
  const words: Record<string, number> = { half: 0.5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
  const months = words[multiplier[1].toLowerCase()] ?? Number(multiplier[1]);
  return Number.isFinite(months) && months >= 0 ? roundMoney(months * monthlyRental) : null;
}

function normalizeNoticeText(value: string): string {
  const words: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
  return Object.entries(words).reduce((current, [word, number]) => current.replace(new RegExp(`\\b${word}\\s*\\(${number}\\)\\b`, 'gi'), word), value)
    .replace(/\bhalf[-\s]*month\b/gi, 'half month').replace(/\s+/g, ' ').trim();
}

function normalizeConfidence(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(normalizeText(value));
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function normalizeDate(value: string): string {
  if (!value) return '';
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso && validDate(iso[1], iso[2], iso[3])) return value;
  const numeric = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (numeric && validDate(numeric[3], numeric[2], numeric[1])) return `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  const months: Record<string, string> = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
  const named = value.toLowerCase().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})$/);
  return named && months[named[2]] && validDate(named[3], months[named[2]], named[1]) ? `${named[3]}-${months[named[2]]}-${named[1].padStart(2, '0')}` : '';
}

function validDate(year: string, month: string, day: string): boolean {
  const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month) && date.getUTCDate() === Number(day);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
