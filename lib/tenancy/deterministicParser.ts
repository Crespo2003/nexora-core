import { currentIsoDate, displayDateToIso, isoToDisplayDate } from '../dates/formatDate';
import { applyRiskEngine, enrichExtractedTenancyTerms, type TenancyLegalIntelligence } from '../ai/extractTenancy';
import type { Confidence, ExtractedField, TenancyExtraction, TenancyExtractionFallbackReason } from './parser';

const empty = (): ExtractedField => ({ value: '', confidence: 'low' });

export function extractTenancyDeterministically(
  rawText: string,
  originalFilename: string,
  mimeType: string,
  fallbackReason: TenancyExtractionFallbackReason,
  advancedAiConfigured = false
): TenancyExtraction {
  const text = rawText.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const first = (
    patterns: RegExp[],
    confidence: Confidence = 'medium',
    accept: (value: string) => boolean = () => true
  ): ExtractedField => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = match?.[1]?.replace(/\s+/g, ' ').trim();
      if (value && accept(value)) return { value, confidence };
    }
    return empty();
  };
  const money = (patterns: RegExp[]) => {
    const found = first(patterns, 'medium', (value) => /^(?:RM|MYR)\s*\d/i.test(value));
    return found.value ? { ...found, value: found.value.replace(/^(?:RM|MYR)\s*/i, '').replace(/,/g, '').trim() } : found;
  };
  const date = (patterns: RegExp[]) => normalizeDateField(first(patterns));
  const clause = (keyword: RegExp) => {
    const sentence = text.split(/(?<=[.!?。！？])\s+|\n+/).map((line) => line.trim()).find((line) => keyword.test(line));
    return sentence ? { value: sentence.slice(0, 700), confidence: 'medium' as const } : empty();
  };

  const property = {
    propertyName: first([/property(?: name)?\s*[:\-]\s*([^\n]+)/i, /premises\s*[:\-]\s*([^\n]+)/i]),
    unitNo: first([/unit(?: no\.?| number)?\s*[:\-]\s*([A-Z0-9\-\/]+)/i, /parcel(?: no\.?)?\s*[:\-]\s*([A-Z0-9\-\/]+)/i]),
    fullAddress: first([/(?:address|premises address)\s*[:\-]\s*([^\n]+(?:\n[^\n]+){0,2})/i]),
    propertyType: first([/(residential|commercial|industrial|office|retail|bungalow|embassy|factory|warehouse|shoplot|condominium|apartment)/i], 'low')
  };
  const landlord = partyFields('landlord|owner', first);
  const tenant = partyFields('tenant', first);
  const financial = {
    monthlyRental: money([/(?:monthly rental|rental)\s*[:\-]?\s*(RM\s*[\d,]+(?:\.\d{2})?)/i]),
    securityDeposit: money([/(?:security deposit|deposit)\s*[:\-]?\s*(RM\s*[\d,]+(?:\.\d{2})?)/i]),
    utilityDeposit: money([/(?:utility deposit|utilities deposit)\s*[:\-]?\s*(RM\s*[\d,]+(?:\.\d{2})?)/i]),
    accessCardDeposit: money([/access card deposit\s*[:\-]?\s*(RM\s*[\d,]+(?:\.\d{2})?)/i]),
    carParkRemoteDeposit: money([/(?:car park|parking)(?: remote| card)? deposit\s*[:\-]?\s*(RM\s*[\d,]+(?:\.\d{2})?)/i])
  };
  const dates = {
    commencementDate: date([/(?:commencement date|start date)\s*[:\-]\s*([^\n]+)/i]),
    expiryDate: date([/(?:expiry date|end date)\s*[:\-]\s*([^\n]+)/i]),
    rentalDueDay: first([/(?:rental due day|rent due day)\s*[:\-]?\s*(\d{1,2})/i, /rent(?:al)?\s+(?:is\s+)?payable\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?/i]),
    renewalOption: first([/(renewal option\s*[:\-]\s*[^\n]+)/i, /(option to renew\s*[^\n]+)/i]),
    noticePeriod: first([/(notice period\s*[:\-]\s*[^\n]+)/i, /(\d+\s*(?:month|months|day|days)\s+notice)/i]),
    renewalReminder: empty()
  };
  const clauses = {
    renewalClause: clause(/renew/i), terminationClause: clause(/terminat|determin/i), diplomaticClause: clause(/diplomatic/i),
    viewingClause: clause(/viewing|inspection/i), illegalActivityRestriction: clause(/illegal|unlawful/i),
    petClause: clause(/pet|animal/i), specialClauses: clause(/special condition|special clause/i),
    otherObligations: clause(/obligation|repair|maintenance/i)
  };
  const all = [...Object.values(property), ...Object.values(landlord), ...Object.values(tenant), ...Object.values(financial), ...Object.values(dates), ...Object.values(clauses)];
  const detected = all.filter((field) => field.value).length;
  const overall: Confidence = detected >= 8 ? 'high' : detected >= 4 ? 'medium' : 'low';
  const legalIntelligence = applyRiskEngine(enrichExtractedTenancyTerms(toLegalIntelligence(property, landlord, tenant, financial, dates, clauses, overall), text), text);

  return {
    property, landlord, tenant, financial, dates, clauses,
    document: {
      originalFilename,
      uploadDate: isoToDisplayDate(currentIsoDate()),
      documentType: mimeType.includes('pdf') ? 'PDF Tenancy Agreement' : mimeType.includes('wordprocessing') ? 'DOCX Tenancy Agreement' : 'TXT Tenancy Agreement',
      extractionStatus: text.length >= 80 ? 'ready' : 'unreadable',
      extractionConfidence: overall,
      usedOcr: false,
      pageCount: null,
      chunkCount: 1,
      aiCallCount: 0,
      model: null,
      fallbackReason
    },
    rawText: text,
    summary: text.length < 80 ? 'The document did not contain enough readable text for reliable extraction.' : `Deterministic fallback extracted ${detected} tenancy fields. Fields below 80% confidence require review.`,
    advancedAiConfigured,
    provider: 'deterministic',
    fallbackUsed: true,
    fallbackReason,
    legalIntelligence
  };
}

function partyFields(
  label: string,
  first: (patterns: RegExp[], confidence?: Confidence, accept?: (value: string) => boolean) => ExtractedField
) {
  return {
    name: first([new RegExp(`(?:${label})\\s*[:\\-]\\s*([^\\n]+)`, 'i')], 'medium', isSafePartyName),
    idNo: first([new RegExp(`(?:${label})[\\s\\S]{0,160}?(?:ic|nric|passport|company no\\.?)\\s*[:\\-]\\s*([A-Z0-9\\-]+)`, 'i')]),
    phone: first([new RegExp(`(?:${label})[\\s\\S]{0,160}?(?:phone|tel|contact)\\s*[:\\-]\\s*([+0-9 \\-]+)`, 'i')]),
    email: first([new RegExp(`(?:${label})[\\s\\S]{0,160}?(?:email|e-mail)\\s*[:\\-]\\s*([^\\s\\n]+@[^\\s\\n]+)`, 'i')])
  };
}

function isSafePartyName(value: string): boolean {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length < 2 || compact.length > 120 || /^\d+$/.test(compact)) return false;
  if (/^(?:name|date|signature|tenant|landlord|owner|witness|page)\b/i.test(compact)) return false;
  if (/---\s*page\s*\d+\s*---|\bname\s*:\s*date\b|\bdate\s*:\s*signature\b/i.test(compact)) return false;
  return !/^[\W_]+$/.test(compact);
}

function normalizeDateField(field: ExtractedField): ExtractedField {
  const value = field.value.trim();
  if (!value) return field;
  if (displayDateToIso(value)) return field;
  const iso = value.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return { value: isoToDisplayDate(iso[1]), confidence: field.confidence };
  const slash = value.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (slash) return { value: `${slash[1].padStart(2, '0')}/${slash[2].padStart(2, '0')}/${slash[3]}`, confidence: field.confidence };
  return { value, confidence: 'low' };
}

function toLegalIntelligence(
  property: TenancyExtraction['property'], landlord: TenancyExtraction['landlord'], tenant: TenancyExtraction['tenant'],
  financial: TenancyExtraction['financial'], dates: TenancyExtraction['dates'], clauses: TenancyExtraction['clauses'], overall: Confidence
): TenancyLegalIntelligence {
  const pct = (field: ExtractedField) => field.value ? field.confidence === 'high' ? 90 : field.confidence === 'medium' ? 70 : 40 : 0;
  const iso = (field: ExtractedField) => displayDateToIso(field.value) ?? '';
  const number = (field: ExtractedField) => {
    const value = Number(field.value);
    return field.value.trim() && Number.isFinite(value) && value >= 0 ? value : null;
  };
  return {
    document_type: property.propertyType.value, confidence: overall === 'high' ? 0.85 : overall === 'medium' ? 0.65 : 0.35,
    tenant: { name: tenant.name.value, company: '', ic_passport: tenant.idNo.value, phone: tenant.phone.value, email: tenant.email.value },
    landlord: { name: landlord.name.value, company: '', ic_passport: landlord.idNo.value, phone: landlord.phone.value, email: landlord.email.value },
    property: { name: property.propertyName.value, unit: property.unitNo.value, address: property.fullAddress.value, type: property.propertyType.value, build_up: '', land_area: '', car_parks: '' },
    financial: { monthly_rental: number(financial.monthlyRental), security_deposit: number(financial.securityDeposit), utility_deposit: number(financial.utilityDeposit), access_card_deposit: number(financial.accessCardDeposit), car_park_deposit: number(financial.carParkRemoteDeposit), stamp_duty: null },
    tenancy: { commencement_date: iso(dates.commencementDate), expiry_date: iso(dates.expiryDate), renewal_option: dates.renewalOption.value, notice_period: dates.noticePeriod.value, payment_due_day: dates.rentalDueDay.value },
    utilities: { tnb: '', water: '', iwk: '', wifi: '' },
    legal: { signatures: '', witnesses: '', stamp_duty: '', inventory: '', restrictions: clauses.illegalActivityRestriction.value ? [clauses.illegalActivityRestriction.value] : [], late_payment: '', termination: clauses.terminationClause.value, viewing_rights: clauses.viewingClause.value, insurance: '', maintenance: clauses.otherObligations.value, access_card: '', car_park: '' },
    special_clauses: [clauses.renewalClause.value, clauses.terminationClause.value, clauses.diplomaticClause.value, clauses.viewingClause.value, clauses.illegalActivityRestriction.value, clauses.petClause.value, clauses.specialClauses.value, clauses.otherObligations.value].filter(Boolean),
    risks: [], warnings: ['Advanced AI extraction was unavailable; deterministic fallback results require review.'],
    field_evidence: {},
    field_confidence: {
      'tenant.name': pct(tenant.name), 'tenant.ic_passport': pct(tenant.idNo), 'tenant.phone': pct(tenant.phone), 'tenant.email': pct(tenant.email),
      'landlord.name': pct(landlord.name), 'landlord.ic_passport': pct(landlord.idNo), 'landlord.phone': pct(landlord.phone), 'landlord.email': pct(landlord.email),
      'property.name': pct(property.propertyName), 'property.unit': pct(property.unitNo), 'property.address': pct(property.fullAddress), 'property.type': pct(property.propertyType),
      'financial.monthly_rental': pct(financial.monthlyRental), 'financial.security_deposit': pct(financial.securityDeposit), 'financial.utility_deposit': pct(financial.utilityDeposit),
      'financial.access_card_deposit': pct(financial.accessCardDeposit), 'financial.car_park_deposit': pct(financial.carParkRemoteDeposit),
      'tenancy.commencement_date': pct(dates.commencementDate), 'tenancy.expiry_date': pct(dates.expiryDate), 'tenancy.renewal_option': pct(dates.renewalOption), 'tenancy.notice_period': pct(dates.noticePeriod), 'tenancy.payment_due_day': pct(dates.rentalDueDay)
    }
  };
}
