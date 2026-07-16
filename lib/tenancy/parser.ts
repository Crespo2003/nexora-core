import { isoToDisplayDate } from '../dates/formatDate';
import {
  extractTenancyDocument,
  extractTenancyText,
  type TenancyDocumentInput,
  type TenancyLegalIntelligence,
  type TenancyProcessingResult
} from '../ai/extractTenancy';

export type Confidence = 'high' | 'medium' | 'low';

export type ExtractedField = {
  value: string;
  confidence: Confidence;
};

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
    model: string;
  };
  rawText: string;
  summary: string;
  advancedAiConfigured: true;
  legalIntelligence: TenancyLegalIntelligence;
};

type ParserOptions = Parameters<typeof extractTenancyText>[2];

export async function extractTenancyDetails(
  rawText: string,
  originalFilename: string,
  mimeType: string,
  options: ParserOptions = {}
): Promise<TenancyExtraction> {
  const result = await extractTenancyText(rawText, originalFilename, options);
  return toLegacyExtraction({ ...result, pageCount: null, usedOcr: false }, originalFilename, mimeType);
}

export async function extractTenancyFile(
  input: TenancyDocumentInput,
  options: ParserOptions = {}
): Promise<TenancyExtraction> {
  const result = await extractTenancyDocument(input, options);
  return toLegacyExtraction(result, input.filename, input.mimeType);
}

function toLegacyExtraction(
  result: TenancyProcessingResult,
  originalFilename: string,
  mimeType: string
): TenancyExtraction {
  const legal = result.extraction;
  const confidence = confidenceLevel(legal.confidence);
  const field = (value: string | number, missingConfidence: Confidence = 'low'): ExtractedField => ({
    value: String(value ?? ''),
    confidence: String(value ?? '').trim() ? confidence : missingConfidence
  });
  const clause = (pattern: RegExp) => legal.special_clauses.find((item) => pattern.test(item)) ?? '';
  const allClauses = legal.special_clauses.join('\n\n');
  const renewalReminder = calculateRenewalReminder(legal.tenancy.expiry_date, legal.tenancy.notice_period);

  return {
    property: {
      propertyName: field(legal.property.name),
      unitNo: field(legal.property.unit),
      fullAddress: field(legal.property.address),
      propertyType: field(legal.property.type)
    },
    landlord: {
      name: field(legal.landlord.name),
      idNo: field(legal.landlord.ic_passport),
      phone: field(legal.landlord.phone),
      email: field(legal.landlord.email)
    },
    tenant: {
      name: field(legal.tenant.name),
      idNo: field(legal.tenant.ic_passport),
      phone: field(legal.tenant.phone),
      email: field(legal.tenant.email)
    },
    financial: {
      monthlyRental: field(legal.financial.monthly_rental),
      securityDeposit: field(legal.financial.security_deposit),
      utilityDeposit: field(legal.financial.utility_deposit),
      accessCardDeposit: field(legal.financial.access_card_deposit),
      carParkRemoteDeposit: field(legal.financial.car_park_deposit)
    },
    dates: {
      commencementDate: field(toDisplayDate(legal.tenancy.commencement_date)),
      expiryDate: field(toDisplayDate(legal.tenancy.expiry_date)),
      rentalDueDay: field(legal.tenancy.payment_due_day),
      renewalOption: field(legal.tenancy.renewal_option),
      noticePeriod: field(legal.tenancy.notice_period),
      renewalReminder: field(toDisplayDate(renewalReminder))
    },
    clauses: {
      renewalClause: field(clause(/renew/i) || legal.tenancy.renewal_option),
      terminationClause: field(clause(/terminat|determin/i)),
      diplomaticClause: field(clause(/diplomatic/i)),
      viewingClause: field(clause(/view|inspect/i)),
      illegalActivityRestriction: field(clause(/illegal|unlawful/i)),
      petClause: field(clause(/pet|animal/i)),
      specialClauses: field(allClauses),
      otherObligations: field(clause(/obligation|repair|maintenance/i))
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
      model: result.model
    },
    rawText: result.rawText,
    summary: result.summary,
    advancedAiConfigured: true,
    legalIntelligence: legal
  };
}

function confidenceLevel(value: number): Confidence {
  if (value >= 0.85) return 'high';
  if (value >= 0.6) return 'medium';
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
