import { displayDateToIso, isoToDisplayDate } from '../dates/formatDate';

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
  };
  rawText: string;
  summary: string;
  advancedAiConfigured: boolean;
};

const emptyField = (confidence: Confidence = 'low'): ExtractedField => ({ value: '', confidence });

function normalizeText(rawText: string): string {
  return rawText.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function moneyValue(value: string): string {
  return value.replace(/RM/gi, '').replace(/,/g, '').trim();
}

function findFirst(text: string, patterns: RegExp[], confidence: Confidence = 'medium'): ExtractedField {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return { value: match[1].trim(), confidence };
  }

  return emptyField();
}

function findMoney(text: string, patterns: RegExp[]): ExtractedField {
  const found = findFirst(text, patterns, 'medium');
  return found.value ? { value: moneyValue(found.value), confidence: found.confidence } : found;
}

function findDate(text: string, patterns: RegExp[]): ExtractedField {
  const found = findFirst(text, patterns, 'medium');
  if (!found.value) return found;

  const value = found.value.trim();
  const alreadyDisplay = displayDateToIso(value);
  if (alreadyDisplay) return { value, confidence: found.confidence };

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    const padded = `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    if (displayDateToIso(padded)) return { value: padded, confidence: found.confidence };
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return { value: isoToDisplayDate(value), confidence: found.confidence };

  return { value, confidence: 'low' };
}

function clauseContaining(text: string, keyword: RegExp): ExtractedField {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((line) => line.trim()).filter(Boolean);
  const sentence = sentences.find((line) => keyword.test(line));
  return sentence ? { value: sentence.slice(0, 700), confidence: 'medium' } : emptyField();
}

function overallConfidence(fields: ExtractedField[]): Confidence {
  const detected = fields.filter((field) => field.value);
  if (detected.length >= 8) return 'high';
  if (detected.length >= 4) return 'medium';
  return 'low';
}

export function extractTenancyDetails(rawText: string, originalFilename: string, mimeType: string): TenancyExtraction {
  const text = normalizeText(rawText);
  const unreadable = text.length < 80;
  const documentType = mimeType.includes('pdf') ? 'PDF Tenancy Agreement' : 'DOCX Tenancy Agreement';

  const extraction: TenancyExtraction = {
    property: {
      propertyName: findFirst(text, [/property(?: name)?\s*[:\-]\s*([^\n]+)/i, /premises\s*[:\-]\s*([^\n]+)/i]),
      unitNo: findFirst(text, [/unit(?: no\.?| number)?\s*[:\-]\s*([A-Z0-9\-\/]+)/i, /parcel(?: no\.?)?\s*[:\-]\s*([A-Z0-9\-\/]+)/i]),
      fullAddress: findFirst(text, [/(?:address|premises address)\s*[:\-]\s*([^\n]+(?:\n[^\n]+){0,2})/i], 'medium'),
      propertyType: findFirst(text, [/(condominium|apartment|serviced residence|terrace|bungalow|shoplot|office|retail|warehouse)/i], 'low')
    },
    landlord: {
      name: findFirst(text, [/landlord\s*[:\-]\s*([^\n]+)/i, /owner\s*[:\-]\s*([^\n]+)/i]),
      idNo: findFirst(text, [/landlord(?:.*?)(?:ic|passport|company no\.?)\s*[:\-]\s*([A-Z0-9\-]+)/i]),
      phone: findFirst(text, [/landlord(?:.*?)(?:phone|tel|contact)\s*[:\-]\s*([+0-9 \-]+)/i]),
      email: findFirst(text, [/landlord(?:.*?)(?:email|e-mail)\s*[:\-]\s*([^\s\n]+@[^\s\n]+)/i])
    },
    tenant: {
      name: findFirst(text, [/tenant\s*[:\-]\s*([^\n]+)/i]),
      idNo: findFirst(text, [/tenant(?:.*?)(?:ic|passport|company no\.?)\s*[:\-]\s*([A-Z0-9\-]+)/i]),
      phone: findFirst(text, [/tenant(?:.*?)(?:phone|tel|contact)\s*[:\-]\s*([+0-9 \-]+)/i]),
      email: findFirst(text, [/tenant(?:.*?)(?:email|e-mail)\s*[:\-]\s*([^\s\n]+@[^\s\n]+)/i])
    },
    financial: {
      monthlyRental: findMoney(text, [/(?:monthly rental|rental)\s*[:\-]?\s*(RM\s*[\d,]+(?:\.\d{2})?)/i]),
      securityDeposit: findMoney(text, [/(?:security deposit|deposit)\s*[:\-]?\s*(RM\s*[\d,]+(?:\.\d{2})?)/i]),
      utilityDeposit: findMoney(text, [/(?:utility deposit|utilities deposit)\s*[:\-]?\s*(RM\s*[\d,]+(?:\.\d{2})?)/i]),
      accessCardDeposit: findMoney(text, [/(?:access card deposit)\s*[:\-]?\s*(RM\s*[\d,]+(?:\.\d{2})?)/i]),
      carParkRemoteDeposit: findMoney(text, [/(?:car park remote\/card deposit|car park remote deposit|parking card deposit)\s*[:\-]?\s*(RM\s*[\d,]+(?:\.\d{2})?)/i])
    },
    dates: {
      commencementDate: findDate(text, [/(?:commencement date|start date)\s*[:\-]\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i]),
      expiryDate: findDate(text, [/(?:expiry date|end date)\s*[:\-]\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i]),
      renewalOption: findFirst(text, [/(renewal option\s*[:\-]\s*[^\n]+)/i, /(option to renew\s*[^\n]+)/i]),
      noticePeriod: findFirst(text, [/(notice period\s*[:\-]\s*[^\n]+)/i, /(\d+\s*(?:month|months|day|days)\s+notice)/i]),
      renewalReminder: emptyField()
    },
    clauses: {
      renewalClause: clauseContaining(text, /renew/i),
      terminationClause: clauseContaining(text, /terminat/i),
      diplomaticClause: clauseContaining(text, /diplomatic/i),
      viewingClause: clauseContaining(text, /viewing|inspection/i),
      illegalActivityRestriction: clauseContaining(text, /illegal|unlawful/i),
      petClause: clauseContaining(text, /pet|animal/i),
      specialClauses: clauseContaining(text, /special condition|special clause/i),
      otherObligations: clauseContaining(text, /obligation|repair|maintenance/i)
    },
    document: {
      originalFilename,
      uploadDate: isoToDisplayDate(new Date().toISOString().slice(0, 10)),
      documentType,
      extractionStatus: unreadable ? 'unreadable' : 'ready',
      extractionConfidence: 'low'
    },
    rawText: text,
    summary: '',
    advancedAiConfigured: false
  };

  const confidence = overallConfidence([
    ...Object.values(extraction.property),
    ...Object.values(extraction.landlord),
    ...Object.values(extraction.tenant),
    ...Object.values(extraction.financial),
    ...Object.values(extraction.dates),
    ...Object.values(extraction.clauses)
  ]);

  extraction.document.extractionConfidence = unreadable ? 'low' : confidence;
  extraction.summary = unreadable
    ? 'The uploaded document did not contain enough readable text for reliable extraction.'
    : `Fallback parser detected ${confidence} confidence tenancy details. Review every field before import.`;

  return extraction;
}
