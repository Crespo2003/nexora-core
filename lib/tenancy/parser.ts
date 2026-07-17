import { isoToDisplayDate } from '../dates/formatDate';
import { extractDocumentText } from '../documents/extractText';
import {
  extractTenancyText,
  type TenancyDocumentInput,
  type TenancyLegalIntelligence,
  type TenancyProcessingResult
} from '../ai/extractTenancy';
import { extractTenancyDeterministically } from './deterministicParser';
import { getOpenAiConfiguration } from '../ai/openAiConfig';

export type Confidence = 'high' | 'medium' | 'low';

export type ExtractedField = {
  value: string;
  confidence: Confidence;
};

export type TenancyExtractionFallbackReason =
  | 'openai_not_configured'
  | 'openai_authentication_failed'
  | 'openai_permission_denied'
  | 'openai_model_not_found'
  | 'openai_rate_limited'
  | 'openai_bad_request'
  | 'openai_server_error'
  | 'openai_timeout'
  | 'openai_request_failed'
  | 'invalid_ai_response'
  | 'ocr_failed'
  | 'text_extraction_failed';

export type TenancyExtraction = {
  property: {
    propertyName: ExtractedField;
    unitNo: ExtractedField;
    fullAddress: ExtractedField;
    propertyType: ExtractedField;
  };
  landlord: {
    name: ExtractedField;
    idNo: ExtractedField;
    phone: ExtractedField;
    email: ExtractedField;
  };
  tenant: {
    name: ExtractedField;
    idNo: ExtractedField;
    phone: ExtractedField;
    email: ExtractedField;
  };
  financial: {
    monthlyRental: ExtractedField;
    securityDeposit: ExtractedField;
    utilityDeposit: ExtractedField;
    accessCardDeposit: ExtractedField;
    carParkRemoteDeposit: ExtractedField;
  };
  dates: {
    commencementDate: ExtractedField;
    expiryDate: ExtractedField;
    rentalDueDay: ExtractedField;
    renewalOption: ExtractedField;
    noticePeriod: ExtractedField;
    renewalReminder: ExtractedField;
  };
  clauses: {
    renewalClause: ExtractedField;
    terminationClause: ExtractedField;
    diplomaticClause: ExtractedField;
    viewingClause: ExtractedField;
    illegalActivityRestriction: ExtractedField;
    petClause: ExtractedField;
    specialClauses: ExtractedField;
    otherObligations: ExtractedField;
  };
  document: {
    originalFilename: string;
    uploadDate: string;
    documentType: string;
    extractionStatus: 'ready' | 'unreadable';
    extractionConfidence: Confidence;
    usedOcr: boolean;
    pageCount: number | null;
    chunkCount: number;
    model: string | null;
    fallbackReason: TenancyExtractionFallbackReason | null;
  };
  rawText: string;
  summary: string;
  advancedAiConfigured: boolean;
  provider: 'openai' | 'deterministic';
  fallbackUsed: boolean;
  fallbackReason: TenancyExtractionFallbackReason | null;
  legalIntelligence: TenancyLegalIntelligence;
};

type ParserOptions = Parameters<typeof extractTenancyText>[2];

export async function extractTenancyDetails(
  rawText: string,
  originalFilename: string,
  mimeType: string,
  options: ParserOptions = {}
): Promise<TenancyExtraction> {
  const aiConfigured = Boolean(options.apiKey?.trim()) || getOpenAiConfiguration().configured;
  try {
    const result = await extractTenancyText(rawText, originalFilename, options);
    return toLegacyExtraction({ ...result, pageCount: null, usedOcr: false }, originalFilename, mimeType);
  } catch (error) {
    const reason = extractionErrorCode(error);
    return extractTenancyDeterministically(rawText, originalFilename, mimeType, reason, aiConfigured && reason !== 'openai_not_configured');
  }
}

export async function extractTenancyFile(
  input: TenancyDocumentInput,
  options: ParserOptions = {}
): Promise<TenancyExtraction> {
  const text = await extractDocumentText(input, options.ocrProvider);
  if (text.status !== 'completed' || !text.text.trim()) {
    throw new Error(text.usedOcr || /ocr/i.test(text.error) ? 'ocr_failed' : 'text_extraction_failed');
  }
  const aiConfigured = Boolean(options.apiKey?.trim()) || getOpenAiConfiguration().configured;
  try {
    const result = await extractTenancyText(text.text, input.filename, options);
    return toLegacyExtraction({ ...result, pageCount: text.pageCount, usedOcr: text.usedOcr }, input.filename, input.mimeType);
  } catch (error) {
    const reason = extractionErrorCode(error);
    const fallback = extractTenancyDeterministically(text.text, input.filename, input.mimeType, reason, aiConfigured && reason !== 'openai_not_configured');
    fallback.document.usedOcr = text.usedOcr;
    fallback.document.pageCount = text.pageCount;
    return fallback;
  }
}

function toLegacyExtraction(
  result: TenancyProcessingResult,
  originalFilename: string,
  mimeType: string
): TenancyExtraction {
  const legal = result.extraction;
  const confidence = confidenceLevel(legal.confidence);
  const field = (value: string | number, path: string, missingConfidence: Confidence = 'low'): ExtractedField => ({
    value: String(value ?? ''),
    confidence: String(value ?? '').trim() ? confidenceLevel((legal.field_confidence[path] ?? legal.confidence * 100) / 100) : missingConfidence
  });
  const clause = (pattern: RegExp) => legal.special_clauses.find((item) => pattern.test(item)) ?? '';
  const allClauses = legal.special_clauses.join('\n\n');
  const renewalReminder = calculateRenewalReminder(legal.tenancy.expiry_date, legal.tenancy.notice_period);

  return {
    property: {
      propertyName: field(legal.property.name, 'property.name'),
      unitNo: field(legal.property.unit, 'property.unit'),
      fullAddress: field(legal.property.address, 'property.address'),
      propertyType: field(legal.property.type, 'property.type')
    },
    landlord: {
      name: field(legal.landlord.name, 'landlord.name'),
      idNo: field(legal.landlord.ic_passport, 'landlord.ic_passport'),
      phone: field(legal.landlord.phone, 'landlord.phone'),
      email: field(legal.landlord.email, 'landlord.email')
    },
    tenant: {
      name: field(legal.tenant.name, 'tenant.name'),
      idNo: field(legal.tenant.ic_passport, 'tenant.ic_passport'),
      phone: field(legal.tenant.phone, 'tenant.phone'),
      email: field(legal.tenant.email, 'tenant.email')
    },
    financial: {
      monthlyRental: field(legal.financial.monthly_rental, 'financial.monthly_rental'),
      securityDeposit: field(legal.financial.security_deposit, 'financial.security_deposit'),
      utilityDeposit: field(legal.financial.utility_deposit, 'financial.utility_deposit'),
      accessCardDeposit: field(legal.financial.access_card_deposit, 'financial.access_card_deposit'),
      carParkRemoteDeposit: field(legal.financial.car_park_deposit, 'financial.car_park_deposit')
    },
    dates: {
      commencementDate: field(toDisplayDate(legal.tenancy.commencement_date), 'tenancy.commencement_date'),
      expiryDate: field(toDisplayDate(legal.tenancy.expiry_date), 'tenancy.expiry_date'),
      rentalDueDay: field(legal.tenancy.payment_due_day, 'tenancy.payment_due_day'),
      renewalOption: field(legal.tenancy.renewal_option, 'tenancy.renewal_option'),
      noticePeriod: field(legal.tenancy.notice_period, 'tenancy.notice_period'),
      renewalReminder: field(toDisplayDate(renewalReminder), 'tenancy.renewal_option')
    },
    clauses: {
      renewalClause: field(clause(/renew/i) || legal.tenancy.renewal_option, 'tenancy.renewal_option'),
      terminationClause: field(legal.legal.termination || clause(/terminat|determin/i), 'legal.termination'),
      diplomaticClause: field(clause(/diplomatic/i), 'special_clauses'),
      viewingClause: field(legal.legal.viewing_rights || clause(/view|inspect/i), 'legal.viewing_rights'),
      illegalActivityRestriction: field(legal.legal.restrictions.join('; ') || clause(/illegal|unlawful/i), 'legal.restrictions'),
      petClause: field(clause(/pet|animal/i), 'special_clauses'),
      specialClauses: field(allClauses, 'special_clauses'),
      otherObligations: field(legal.legal.maintenance || clause(/obligation|repair|maintenance/i), 'legal.maintenance')
    },
    document: {
      originalFilename,
      uploadDate: isoToDisplayDate(new Date().toISOString().slice(0, 10)),
      documentType: legal.document_type || documentTypeFor(mimeType),
      extractionStatus: result.rawText.length >= 80 ? 'ready' : 'unreadable',
      extractionConfidence: confidence,
      usedOcr: result.usedOcr,
      pageCount: result.pageCount,
      chunkCount: result.chunkCount,
      model: result.model,
      fallbackReason: null
    },
    rawText: result.rawText,
    summary: result.summary,
    advancedAiConfigured: true,
    provider: 'openai',
    fallbackUsed: false,
    fallbackReason: null,
    legalIntelligence: legal
  };
}

function extractionErrorCode(error: unknown): TenancyExtractionFallbackReason {
  const code = error instanceof Error ? error.message : '';
  if (code === 'openai_not_configured' || code === 'openai-not-configured') return 'openai_not_configured';
  if (code === 'openai_authentication_failed') return 'openai_authentication_failed';
  if (code === 'openai_permission_denied') return 'openai_permission_denied';
  if (code === 'openai_model_not_found') return 'openai_model_not_found';
  if (code === 'openai_rate_limited') return 'openai_rate_limited';
  if (code === 'openai_bad_request') return 'openai_bad_request';
  if (code === 'openai_server_error') return 'openai_server_error';
  if (code === 'openai_timeout' || code === 'openai-timeout') return 'openai_timeout';
  if (code === 'invalid_ai_response' || /invalid-extraction|empty-extraction|refused-extraction/.test(code)) return 'invalid_ai_response';
  if (code === 'ocr_failed' || /ocr/.test(code)) return 'ocr_failed';
  if (code === 'text_extraction_failed' || /document-text|insufficient-document-text|empty-extraction|unreadable-document/.test(code)) return 'text_extraction_failed';
  return 'openai_request_failed';
}

function confidenceLevel(value: number): Confidence {
  if (value >= 0.8) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

function toDisplayDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? isoToDisplayDate(value) : '';
}

function calculateRenewalReminder(expiryDate: string, noticePeriod: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return '';
  const date = new Date(`${expiryDate}T00:00:00Z`);
  const months = Number(noticePeriod.match(/\d+(?:\.\d+)?/)?.[0] ?? 3);
  const multiplier = /day/i.test(noticePeriod) ? 0 : Math.max(1, Math.ceil(months));
  if (/day/i.test(noticePeriod)) date.setUTCDate(date.getUTCDate() - Math.max(1, Math.ceil(months)));
  else date.setUTCMonth(date.getUTCMonth() - multiplier);
  return date.toISOString().slice(0, 10);
}

function documentTypeFor(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF Tenancy Agreement';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'DOCX Tenancy Agreement';
  return 'TXT Tenancy Agreement';
}
