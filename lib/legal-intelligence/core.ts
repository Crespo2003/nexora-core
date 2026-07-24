import { formatNexoraDate } from '../dates/formatDate';
import { formatMYR } from '../formatters';

export const clauseCategories = [
  'Rental payment', 'Late payment', 'Security deposit', 'Utility deposit', 'Access card deposit', 'Car park deposit',
  'Renewal', 'Notice period', 'Termination', 'Early termination', 'Default', 'Viewing rights', 'Entry and inspection',
  'Repairs', 'Structural maintenance', 'General maintenance', 'Utilities', 'Insurance', 'Stamp duty', 'Inventory',
  'Illegal use', 'Subletting', 'Assignment', 'Sale during tenancy', 'Force majeure / Act of God', 'Indemnity',
  'Forfeiture', 'Governing law', 'Dispute resolution', 'Handover', 'Reinstatement', 'Renovation',
  'Business-use restriction', 'Witnessing', 'Special conditions'
] as const;

export type ClauseCategory = typeof clauseCategories[number];
export type LegalRiskLevel = 'low' | 'medium' | 'high';
export type ResponsibleParty = 'tenant' | 'landlord' | 'both' | 'unclear';

export type LegalClause = {
  id: string;
  category: ClauseCategory;
  title: string;
  summary: string;
  full_text: string;
  source_page: number | null;
  source_excerpt: string;
  confidence: number;
  risk_level: LegalRiskLevel;
  responsible_party: ResponsibleParty;
  obligation: string;
  trigger: string;
  deadline: string;
  financial_impact: string;
  recommendation: string;
};

export type StructuredLegalRisk = {
  id: string;
  severity: LegalRiskLevel;
  category: string;
  title: string;
  reason: string;
  recommendation: string;
  source_page: number | null;
  source_excerpt: string;
  rule_id: string;
};

export type LegalIntelligenceResult = {
  version: 'sprint-015-v1';
  executive_summary: string;
  normalized_fields: Record<string, string>;
  clauses: LegalClause[];
  risks: StructuredLegalRisk[];
};

export type ComparisonFinding = {
  id: string;
  kind: 'field' | 'added_clause' | 'removed_clause' | 'modified_clause' | 'financial' | 'date' | 'risk';
  category: string;
  title: string;
  before: string;
  after: string;
  source_reference_a: SourceReference;
  source_reference_b: SourceReference;
  materiality: LegalRiskLevel;
};

export type AgreementComparison = {
  changed_fields: ComparisonFinding[];
  added_clauses: ComparisonFinding[];
  removed_clauses: ComparisonFinding[];
  modified_clauses: ComparisonFinding[];
  financial_changes: ComparisonFinding[];
  date_changes: ComparisonFinding[];
  risk_changes: ComparisonFinding[];
  summary: string;
};

export type SourceReference = {
  source_page: number | null;
  source_excerpt: string;
};

type Facts = {
  document_type?: unknown;
  tenant?: Record<string, unknown>;
  landlord?: Record<string, unknown>;
  property?: Record<string, unknown>;
  financial?: Record<string, unknown>;
  tenancy?: Record<string, unknown>;
  utilities?: Record<string, unknown>;
  legal?: Record<string, unknown>;
  special_clauses?: unknown;
  clauses?: unknown;
  risks?: unknown;
  field_evidence?: unknown;
};

const categoryFilters: Record<string, ClauseCategory[]> = {
  Financial: ['Rental payment', 'Late payment', 'Security deposit', 'Utility deposit', 'Access card deposit', 'Car park deposit', 'Stamp duty', 'Forfeiture'],
  Renewal: ['Renewal', 'Notice period'],
  Termination: ['Termination', 'Early termination', 'Default', 'Forfeiture', 'Handover', 'Reinstatement'],
  Maintenance: ['Repairs', 'Structural maintenance', 'General maintenance', 'Insurance', 'Renovation'],
  Utilities: ['Utilities', 'Utility deposit'],
  Entry: ['Viewing rights', 'Entry and inspection'],
  Restrictions: ['Illegal use', 'Subletting', 'Assignment', 'Business-use restriction'],
  Other: ['Sale during tenancy', 'Force majeure / Act of God', 'Indemnity', 'Governing law', 'Dispute resolution', 'Inventory', 'Witnessing', 'Special conditions']
};

export function categoriesForFilter(filter: string): ClauseCategory[] | null {
  return filter === 'All' ? null : categoryFilters[filter] ?? null;
}

export function buildLegalIntelligence(input: unknown, rawText: string): LegalIntelligenceResult {
  const facts = record(input) as Facts;
  const supplied = array(facts.clauses).map((item) => normalizeClause(item, rawText)).filter(isPresent);
  const deterministic = deterministicClauses(facts, rawText);
  const clauses = mergeClauses(supplied, deterministic);
  const risks = evaluateClauseRisks(facts, clauses, rawText);
  return {
    version: 'sprint-015-v1',
    executive_summary: createExecutiveLegalSummary(facts, clauses, risks),
    normalized_fields: normalizedFields(facts),
    clauses,
    risks
  };
}

export function normalizeClause(input: unknown, rawText = ''): LegalClause | null {
  const item = record(input);
  const category = clauseCategory(text(item.category));
  const fullText = text(item.full_text) || text(item.source_excerpt);
  const summary = text(item.summary) || fullText;
  if (!category || !summary) return null;
  const source = sourceReference(rawText, text(item.source_excerpt) || fullText, Number(item.source_page));
  const title = text(item.title) || category;
  const normalized = {
    category,
    title,
    summary,
    full_text: fullText || source.source_excerpt,
    source_page: source.source_page,
    source_excerpt: source.source_excerpt,
    confidence: confidence(item.confidence),
    risk_level: riskLevel(text(item.risk_level)),
    responsible_party: responsibleParty(text(item.responsible_party), `${summary} ${fullText}`),
    obligation: text(item.obligation),
    trigger: text(item.trigger),
    deadline: text(item.deadline),
    financial_impact: text(item.financial_impact),
    recommendation: text(item.recommendation)
  };
  return { id: text(item.id) || stableId('clause', `${normalized.category}|${normalized.title}|${normalized.full_text}`), ...normalized };
}

export function searchClauses(clauses: LegalClause[], query: string, filter = 'All'): LegalClause[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const allowed = categoriesForFilter(filter);
  return clauses.filter((clause) => {
    if (allowed && !allowed.includes(clause.category)) return false;
    const haystack = [clause.title, clause.category, clause.summary, clause.source_excerpt, clause.full_text].join(' ').toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function compareLegalIntelligence(a: LegalIntelligenceResult, b: LegalIntelligenceResult): AgreementComparison {
  const changed_fields: ComparisonFinding[] = [];
  const financial_changes: ComparisonFinding[] = [];
  const date_changes: ComparisonFinding[] = [];
  const pairs: Array<[string, string, string, 'field' | 'financial' | 'date']> = [
    ['Monthly rental', financialValue(a, 'monthly_rental'), financialValue(b, 'monthly_rental'), 'financial'],
    ['Security deposit', financialValue(a, 'security_deposit'), financialValue(b, 'security_deposit'), 'financial'],
    ['Utility deposit', financialValue(a, 'utility_deposit'), financialValue(b, 'utility_deposit'), 'financial'],
    ['Access card deposit', financialValue(a, 'access_card_deposit'), financialValue(b, 'access_card_deposit'), 'financial'],
    ['Car park deposit', financialValue(a, 'car_park_deposit'), financialValue(b, 'car_park_deposit'), 'financial'],
    ['Commencement date', dateValue(a, 'commencement_date'), dateValue(b, 'commencement_date'), 'date'],
    ['Expiry date', dateValue(a, 'expiry_date'), dateValue(b, 'expiry_date'), 'date'],
    ['Payment due date', clauseDeadline(a, 'Rental payment'), clauseDeadline(b, 'Rental payment'), 'field'],
    ['Renewal', clauseText(a, 'Renewal'), clauseText(b, 'Renewal'), 'field'],
    ['Notice period', clauseText(a, 'Notice period'), clauseText(b, 'Notice period'), 'field'],
    ['Termination', clauseText(a, 'Termination'), clauseText(b, 'Termination'), 'field']
  ];
  for (const [title, before, after, kind] of pairs) {
    if (normalize(before) === normalize(after)) continue;
    const finding = comparisonFinding(kind, title, before, after, sourceForCategory(a, title), sourceForCategory(b, title), materialityFor(title));
    if (kind === 'financial') financial_changes.push(finding);
    else if (kind === 'date') date_changes.push(finding);
    else changed_fields.push(finding);
  }

  const added_clauses: ComparisonFinding[] = [];
  const removed_clauses: ComparisonFinding[] = [];
  const modified_clauses: ComparisonFinding[] = [];
  const aByKey = new Map(a.clauses.map((clause) => [clauseKey(clause), clause]));
  const bByKey = new Map(b.clauses.map((clause) => [clauseKey(clause), clause]));
  for (const [key, after] of bByKey) {
    const before = aByKey.get(key);
    if (!before) {
      const comparable = a.clauses.find((clause) => clause.category === after.category);
      if (!comparable) added_clauses.push(comparisonFinding('added_clause', after.category, '', after.summary, emptySource(), clauseSource(after), after.risk_level));
      continue;
    }
    if (normalizeClauseMeaning(before) !== normalizeClauseMeaning(after)) {
      modified_clauses.push(comparisonFinding('modified_clause', after.category, before.summary, after.summary, clauseSource(before), clauseSource(after), maxMateriality(before.risk_level, after.risk_level)));
    }
  }
  for (const [key, before] of aByKey) {
    if (!bByKey.has(key) && !b.clauses.some((clause) => clause.category === before.category)) {
      removed_clauses.push(comparisonFinding('removed_clause', before.category, before.summary, '', clauseSource(before), emptySource(), before.risk_level));
    }
  }

  const risk_changes = compareRisks(a.risks, b.risks);
  const count = changed_fields.length + added_clauses.length + removed_clauses.length + modified_clauses.length + financial_changes.length + date_changes.length + risk_changes.length;
  return {
    changed_fields, added_clauses, removed_clauses, modified_clauses, financial_changes, date_changes, risk_changes,
    summary: count ? `${count} material legal or commercial change${count === 1 ? '' : 's'} detected between Agreement A and Agreement B.` : 'No material legal or commercial changes were detected between the compared agreements.'
  };
}

function deterministicClauses(facts: Facts, rawText: string): LegalClause[] {
  const found: LegalClause[] = [];
  const add = (category: ClauseCategory, title: string, pattern: RegExp, options: Partial<LegalClause> = {}) => {
    const source = sourceForPattern(rawText, pattern);
    if (!source.source_excerpt) return;
    found.push(makeClause(category, title, source, options));
  };
  add('Rental payment', 'Rental payment', /(?:rent(?:al)?|sewa|租金)[\s\S]{0,180}?(?:due|payable|paid|calendar month|每月|每个月)/i, { deadline: paymentDeadline(text(record(facts.tenancy).payment_due_day)), responsible_party: 'tenant' });
  add('Late payment', 'Late-payment terms', /(?:late payment|interest on late|overdue rent|迟付|滞纳)[\s\S]{0,200}/i, { responsible_party: 'tenant' });
  add('Security deposit', 'Security deposit', /(?:security deposit|deposit.*security|保证金|按金)[\s\S]{0,180}/i, { responsible_party: 'tenant' });
  add('Utility deposit', 'Utility deposit', /(?:utility deposit|utilities deposit|水电.*按金|公用事业.*按金)[\s\S]{0,180}/i, { responsible_party: 'tenant' });
  add('Access card deposit', 'Access-card deposit', /(?:access card.*deposit|card deposit|门卡.*按金)[\s\S]{0,180}/i, { responsible_party: 'tenant' });
  add('Car park deposit', 'Car-park deposit', /(?:car ?park.*deposit|parking.*deposit|停车.*按金)[\s\S]{0,180}/i, { responsible_party: 'tenant' });
  add('Renewal', 'Renewal', /(?:renew(?:al)?|extension|续租|续约)[\s\S]{0,220}/i, { responsible_party: 'both' });
  add('Notice period', 'Notice period', /(?:notice(?: period)?|written notice|通知期|书面通知)[\s\S]{0,180}/i, { responsible_party: 'both' });
  add('Termination', 'Termination', /(?:termination|terminate|determination|penamatan|终止)[\s\S]{0,240}/i, { responsible_party: 'both' });
  add('Early termination', 'Early termination', /(?:early termination|terminate.*before|提前终止|提早终止)[\s\S]{0,240}/i, { responsible_party: 'both' });
  add('Default', 'Default', /(?:default|breach|failure to pay|违约)[\s\S]{0,220}/i, { responsible_party: 'unclear' });
  add('Viewing rights', 'Viewing rights', /(?:viewing|view the premises|show the premises|看房)[\s\S]{0,180}/i, { responsible_party: 'landlord' });
  add('Entry and inspection', 'Entry and inspection', /(?:entry|enter the premises|inspect(?:ion)?|检查|进入)[\s\S]{0,220}/i, { responsible_party: 'landlord' });
  add('Structural maintenance', 'Structural maintenance', /(?:structural|main structure|roof|foundation|主体结构)[\s\S]{0,220}/i, { responsible_party: 'landlord' });
  add('Repairs', 'Repair responsibility', /(?:repair|repairs|pembaikan|维修)[\s\S]{0,220}/i, { responsible_party: 'unclear' });
  add('General maintenance', 'General maintenance', /(?:maintenance|maintain|upkeep|maintenance responsibility|维护|保养)[\s\S]{0,220}/i, { responsible_party: 'unclear' });
  add('Utilities', 'Utilities', /(?:utilities|electric(?:ity)?|water|tnb|iwk|wifi|公用事业|水电)[\s\S]{0,220}/i, { responsible_party: 'unclear' });
  add('Insurance', 'Insurance', /(?:insurance|insured|保险)[\s\S]{0,180}/i, { responsible_party: 'unclear' });
  add('Stamp duty', 'Stamp duty', /(?:stamp duty|stamping|lhdn|hasil|印花税)[\s\S]{0,180}/i, { responsible_party: 'unclear' });
  add('Inventory', 'Inventory', /(?:inventory|schedule of contents|fixtures and fittings|inventori|物品清单)[\s\S]{0,180}/i, { responsible_party: 'both' });
  add('Illegal use', 'Illegal use restriction', /(?:illegal|unlawful|prohibited use|违法使用|非法用途)[\s\S]{0,180}/i, { responsible_party: 'tenant' });
  add('Subletting', 'Subletting', /(?:sublet|subletting|转租)[\s\S]{0,180}/i, { responsible_party: 'tenant' });
  add('Assignment', 'Assignment', /(?:assign(?:ment)?|转让)[\s\S]{0,180}/i, { responsible_party: 'tenant' });
  add('Sale during tenancy', 'Sale during tenancy', /(?:sale of the premises|sell the premises|出售.*物业)[\s\S]{0,180}/i, { responsible_party: 'landlord' });
  add('Force majeure / Act of God', 'Force majeure', /(?:force majeure|act of god|不可抗力|天灾)[\s\S]{0,180}/i, { responsible_party: 'both' });
  add('Indemnity', 'Indemnity', /(?:indemn(?:ity|ify)|赔偿|弥偿)[\s\S]{0,220}/i, { responsible_party: 'unclear' });
  add('Forfeiture', 'Forfeiture', /(?:forfeit(?:ure)?|evict|re-entry|没收|收回)[\s\S]{0,220}/i, { responsible_party: 'landlord' });
  add('Governing law', 'Governing law', /(?:governed by|governing law|laws of malaysia|适用法律)[\s\S]{0,160}/i, { responsible_party: 'both' });
  add('Dispute resolution', 'Dispute resolution', /(?:dispute|arbitration|mediation|jurisdiction|争议|仲裁)[\s\S]{0,200}/i, { responsible_party: 'both' });
  add('Handover', 'Handover', /(?:handover|hand over|vacant possession|交还|交接)[\s\S]{0,180}/i, { responsible_party: 'tenant' });
  add('Reinstatement', 'Reinstatement', /(?:reinstate|reinstatement|restore|复原)[\s\S]{0,180}/i, { responsible_party: 'tenant' });
  add('Renovation', 'Renovation', /(?:renovat|alteration|fit[- ]?out|装修|改造)[\s\S]{0,200}/i, { responsible_party: 'tenant' });
  add('Business-use restriction', 'Business-use restriction', /(?:business use|commercial use|permitted use|营业用途|商业用途)[\s\S]{0,180}/i, { responsible_party: 'tenant' });
  add('Witnessing', 'Witnessing', /(?:witness(?:ed|es)?|in the presence of|见证人|证人)[\s\S]{0,180}/i, { responsible_party: 'both' });
  for (const clause of array(facts.special_clauses)) {
    const clauseText = text(clause);
    if (!clauseText) continue;
    const source = sourceReference(rawText, clauseText, null);
    if (source.source_excerpt) found.push(makeClause('Special conditions', 'Special condition', source, { responsible_party: responsibleParty('', clauseText) }));
  }
  return found;
}

function evaluateClauseRisks(facts: Facts, clauses: LegalClause[], rawText: string): StructuredLegalRisk[] {
  const risks: StructuredLegalRisk[] = [];
  const add = (ruleId: string, severity: LegalRiskLevel, category: string, title: string, reason: string, recommendation: string, source = emptySource()) => {
    if (risks.some((risk) => risk.rule_id === ruleId)) return;
    risks.push({ id: stableId('risk', ruleId), severity, category, title, reason, recommendation, source_page: source.source_page, source_excerpt: source.source_excerpt, rule_id: ruleId });
  };
  const missing = (category: ClauseCategory, severity: LegalRiskLevel, ruleId: string, title: string, recommendation: string) => {
    if (!clauses.some((clause) => clause.category === category)) add(ruleId, severity, category, title, `${category} is missing from the document and requires legal review.`, recommendation);
  };
  missing('Renewal', 'medium', 'missing_renewal_clause', 'Renewal clause missing', 'Confirm whether renewal is intentionally excluded or document the renewal process.');
  missing('Termination', 'high', 'missing_termination_clause', 'Termination clause missing', 'Add clear termination events, notice periods, remedies, and handover obligations.');
  missing('Notice period', 'medium', 'missing_notice_period', 'Notice period missing', 'State a clear notice duration and when it begins to run.');
  if (!clauses.some((clause) => clause.category === 'Viewing rights' || clause.category === 'Entry and inspection')) add('missing_viewing_or_inspection_clause', 'medium', 'Entry and inspection', 'Inspection clause missing', 'Viewing or inspection rights are missing from the document and require legal review.', 'Add reasonable access, notice, and inspection conditions.');
  missing('Structural maintenance', 'medium', 'missing_structural_maintenance', 'Structural maintenance responsibility missing', 'State who is responsible for structural repairs.');
  missing('Utilities', 'medium', 'missing_utility_responsibility', 'Utility responsibility missing', 'State which party pays and administers each utility account.');
  missing('Inventory', 'medium', 'missing_inventory_schedule', 'Inventory schedule missing', 'Attach a signed inventory and condition schedule where applicable.');
  missing('Witnessing', 'medium', 'missing_witness', 'Witnessing provision missing', 'Confirm witnessing requirements before execution.');
  const legal = record(facts.legal);
  if (!text(legal.signatures) && !/\bsign(?:ed|ature)|execution|ditandatangani|签署/i.test(rawText)) add('missing_signatures', 'high', 'Execution', 'Signature evidence missing', 'Signature or execution evidence is missing from the document and requires legal review.', 'Confirm that all required parties have signed the final agreement.');
  if (!clauses.some((clause) => clause.category === 'Stamp duty') && !money(record(facts.financial).stamp_duty)) add('missing_stamp_duty', 'medium', 'Stamp duty', 'Stamp-duty reference missing', 'Stamp-duty reference is missing from the document and requires legal review.', 'Verify assessment and stamping with LHDN before relying on the agreement.');
  missing('Illegal use', 'medium', 'missing_illegal_use_clause', 'Illegal-use restriction missing', 'Add a clear restriction against unlawful use of the premises.');
  missing('Governing law', 'low', 'missing_governing_law', 'Governing-law clause missing', 'State the governing law for the agreement.');
  missing('Dispute resolution', 'low', 'missing_dispute_resolution', 'Dispute-resolution clause missing', 'State how disputes will be escalated or resolved.');

  const rentalValues = labelledMoneyValues(rawText, /(?:monthly\s+rent(?:al)?|rent(?:al)?\s+(?:of|is|shall be|payable)?|sewa\s+bulanan|每月租金)[\s\S]{0,70}?RM\s*([\d,]+(?:\.\d{1,2})?)/gi);
  if (uniqueNumbers(rentalValues).length > 1) add('conflicting_rental_amounts', 'high', 'Financial', 'Conflicting rental amounts', 'Conflicting rental amounts were detected. Requires legal review before signing.', 'Reconcile the operative rental amount across the body and schedules.', sourceForPattern(rawText, /monthly\s+rent(?:al)?[\s\S]{0,100}/i));
  const depositValues = labelledMoneyValues(rawText, /(?:security|utility|access card|car ?park)\s+deposit[\s\S]{0,70}?RM\s*([\d,]+(?:\.\d{1,2})?)/gi);
  if (uniqueNumbers(depositValues).length > 4) add('conflicting_deposit_amounts', 'high', 'Financial', 'Potentially conflicting deposits', 'Multiple deposit amounts require legal review to confirm the applicable schedule.', 'Reconcile every deposit type and stated amount.', sourceForPattern(rawText, /deposit[\s\S]{0,100}/i));
  const financial = record(facts.financial);
  const rental = money(financial.monthly_rental);
  const securityMonths = statedMonths(rawText, /security\s+deposit[\s\S]{0,90}?((?:\d+(?:\.\d+)?)|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve))\s*months?/i);
  if (securityMonths && rental && Math.abs(rental * securityMonths - money(financial.security_deposit)) > 1) add('security_deposit_multiple_mismatch', 'high', 'Security deposit', 'Requires confirmation: security deposit mismatch', `The extracted security deposit is preserved, but it conflicts with the stated ${securityMonths}-month rental multiple.`, 'Requires confirmation: reconcile the stated multiple and payable amount without overwriting the extracted value.', sourceForPattern(rawText, /security\s+deposit[\s\S]{0,120}/i));
  const utilityMonths = statedMonths(rawText, /utility\s+deposit[\s\S]{0,90}?((?:\d+(?:\.\d+)?)|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve))\s*months?/i);
  if (utilityMonths && rental && Math.abs(rental * utilityMonths - money(financial.utility_deposit)) > 1) add('utility_deposit_multiple_mismatch', 'high', 'Utility deposit', 'Requires confirmation: utility deposit mismatch', `The extracted utility deposit is preserved, but it conflicts with the stated ${utilityMonths}-month rental multiple.`, 'Requires confirmation: reconcile the stated multiple and payable amount without overwriting the extracted value.', sourceForPattern(rawText, /utility\s+deposit[\s\S]{0,120}/i));
  const tenancy = record(facts.tenancy);
  const start = text(tenancy.commencement_date);
  const end = text(tenancy.expiry_date);
  if (start && end && new Date(`${end}T00:00:00Z`) <= new Date(`${start}T00:00:00Z`)) add('invalid_tenancy_duration', 'high', 'Tenancy period', 'Invalid tenancy duration', 'The expiry date is not later than the commencement date.', 'Correct the commencement and expiry dates before signing.');
  if (hasConflictingDates(rawText)) add('conflicting_tenancy_dates', 'high', 'Tenancy period', 'Conflicting tenancy dates', 'Conflicting commencement or expiry dates were detected. Requires legal review.', 'Reconcile dates across the agreement and schedules.', sourceForPattern(rawText, /(?:commencement|expiry|start|end)\s+date[\s\S]{0,100}/i));
  const late = clauses.find((clause) => clause.category === 'Late payment');
  const interest = Number((late?.full_text ?? '').match(/(\d+(?:\.\d+)?)\s*%/)?.[1] ?? 0);
  if (late && (!interest || interest > 12)) add('late_payment_interest_unclear_or_high', interest > 24 ? 'high' : 'medium', 'Late payment', 'Late-payment interest requires review', interest ? `Late-payment interest of ${interest}% appears commercially unusual or requires legal review.` : 'Late-payment interest is unclear and requires legal review.', 'Confirm the rate, calculation basis, cure period, and enforceability.', clauseSource(late));
  const forfeiture = clauses.find((clause) => clause.category === 'Forfeiture');
  if (forfeiture && /without\s+(?:any\s+)?(?:notice|cure)|immediate(?:ly)?\s+(?:forfeit|termination)|forthwith/i.test(forfeiture.full_text)) add('immediate_forfeiture_without_cure', 'high', 'Forfeiture', 'Immediate forfeiture without clear cure period', 'The forfeiture wording may be potentially one-sided and requires legal review.', 'Add a clear breach notice and reasonable cure period.', clauseSource(forfeiture));
  const repairs = clauses.filter((clause) => ['Repairs', 'Structural maintenance', 'General maintenance'].includes(clause.category));
  if (repairs.length && repairs.every((clause) => clause.responsible_party === 'unclear')) add('unclear_repair_responsibility', 'medium', 'Maintenance', 'Repair responsibility unclear', 'Repair responsibility is ambiguous and requires legal review.', 'Allocate structural, routine, damage-related, and emergency repairs clearly.', clauseSource(repairs[0]));
  const utilities = clauses.find((clause) => clause.category === 'Utilities');
  if (utilities && utilities.responsible_party === 'unclear') add('unclear_utility_responsibility', 'medium', 'Utilities', 'Utility responsibility unclear', 'Utility responsibility is ambiguous and requires legal review.', 'Identify the party responsible for each account and payment.', clauseSource(utilities));
  for (const [category, ruleId, title, recommendation] of [
    ['Handover', 'unclear_handover_condition', 'Handover condition unclear', 'State the condition, keys, meter readings, and handover evidence required.'],
    ['Reinstatement', 'unclear_reinstatement_requirement', 'Reinstatement requirement unclear', 'State whether reinstatement is required and the standard to be met.']
  ] as const) {
    const clause = clauses.find((item) => item.category === category);
    if (clause && !clause.obligation && clause.full_text.length < 30) add(ruleId, 'medium', category, title, `${title} and requires legal review.`, recommendation, clauseSource(clause));
  }
  const entry = clauses.find((clause) => clause.category === 'Entry and inspection' || clause.category === 'Viewing rights');
  const unusualEntry = sourceForPattern(rawText, /(?:enter|entry|inspect(?:ion)?|viewing)[\s\S]{0,160}?(?:without\s+(?:prior\s+)?notice|at\s+any\s+time)/i);
  if ((entry && /without\s+(?:prior\s+)?notice|at\s+any\s+time/i.test(entry.full_text)) || unusualEntry.source_excerpt) add('unusual_entry_rights', 'high', 'Entry and inspection', 'Unusual entry rights', 'The entry wording may be potentially one-sided and requires legal review.', 'Add reasonable notice, timing, and emergency-only exceptions.', unusualEntry.source_excerpt ? unusualEntry : clauseSource(entry));
  const termination = clauses.find((clause) => clause.category === 'Termination' || clause.category === 'Early termination');
  if (termination && /sole\s+discretion|unilateral(?:ly)?|at\s+any\s+time/i.test(termination.full_text)) add('unusual_unilateral_termination', 'high', 'Termination', 'Unilateral termination right', 'The termination wording may be potentially one-sided and requires legal review.', 'Balance termination rights and specify notice and cure requirements.', clauseSource(termination));
  const indemnity = clauses.find((clause) => clause.category === 'Indemnity');
  if (indemnity && /all\s+(?:loss|claims|liabilit)|whatsoever|without\s+limit/i.test(indemnity.full_text)) add('broad_indemnity', 'medium', 'Indemnity', 'Broad indemnity clause', 'The indemnity wording appears broad and requires legal review.', 'Limit indemnity to identifiable, proportionate, and lawful losses.', clauseSource(indemnity));
  for (const item of array(facts.risks)) {
    const risk = record(item);
    const reason = text(risk.reason);
    if (!reason) continue;
    const ruleId = text(risk.code) || stableId('ai-risk', reason);
    add(ruleId, riskLevel(text(risk.severity)), text(risk.category) || 'AI review', titleFromReason(reason), `${reason} Requires legal review.`, text(risk.recommendation) || 'Review this issue against the signed agreement.', { source_page: numberOrNull(risk.source_page), source_excerpt: text(risk.source_excerpt) });
  }
  return risks.sort((left, right) => severityScore(right.severity) - severityScore(left.severity) || left.title.localeCompare(right.title));
}

function createExecutiveLegalSummary(facts: Facts, clauses: LegalClause[], risks: StructuredLegalRisk[]): string {
  const tenant = text(record(facts.tenant).name);
  const landlord = text(record(facts.landlord).name);
  const property = text(record(facts.property).address) || text(record(facts.property).name);
  const tenancy = record(facts.tenancy);
  const financial = record(facts.financial);
  const period = [formatDate(text(tenancy.commencement_date)), formatDate(text(tenancy.expiry_date))].filter(Boolean).join(' to ');
  const amounts = [
    money(financial.monthly_rental) ? `${formatMYR(money(financial.monthly_rental))} monthly rental` : '',
    money(financial.security_deposit) ? `${formatMYR(money(financial.security_deposit))} security deposit` : '',
    money(financial.utility_deposit) ? `${formatMYR(money(financial.utility_deposit))} utility deposit` : ''
  ].filter(Boolean).join(', ');
  const maintenance = clauses.find((clause) => clause.category === 'Structural maintenance' || clause.category === 'General maintenance');
  const utilities = clauses.find((clause) => clause.category === 'Utilities');
  const view = clauses.find((clause) => clause.category === 'Viewing rights' || clause.category === 'Entry and inspection');
  const high = risks.filter((risk) => risk.severity === 'high').length;
  const medium = risks.filter((risk) => risk.severity === 'medium').length;
  const priorities = risks.slice(0, 3).map((risk) => risk.title.toLowerCase()).join(', ');
  return [
    `This is a ${text(facts.document_type).toLowerCase() || 'tenancy'} agreement${tenant || landlord ? ` between ${[tenant, landlord].filter(Boolean).join(' and ')}` : ''}${property ? ` for ${property}` : ''}${period ? ` from ${period}` : ''}.`,
    amounts ? `Key financial terms: ${amounts}.` : '',
    text(tenancy.payment_due_day) ? `Rent is due on day ${text(tenancy.payment_due_day)} of each month.` : '',
    clauses.some((clause) => clause.category === 'Renewal') ? 'A renewal provision was detected.' : 'No renewal provision was detected.',
    maintenance ? `${maintenance.responsible_party === 'unclear' ? 'Maintenance responsibility requires review.' : `${capitalize(maintenance.responsible_party)} is identified for maintenance.`}` : '',
    utilities ? `${utilities.responsible_party === 'unclear' ? 'Utility responsibility requires review.' : `${capitalize(utilities.responsible_party)} is identified for utilities.`}` : '',
    view ? 'Entry or viewing wording is present.' : '',
    `The agreement contains ${high} high-risk and ${medium} medium-risk issue${high + medium === 1 ? '' : 's'}.`,
    priorities ? `Priority actions: ${priorities}.` : ''
  ].filter(Boolean).join(' ');
}

function mergeClauses(supplied: LegalClause[], derived: LegalClause[]): LegalClause[] {
  const result = new Map<string, LegalClause>();
  for (const clause of [...derived, ...supplied]) {
    const key = clauseKey(clause);
    const prior = result.get(key);
    if (!prior || clause.confidence >= prior.confidence) result.set(key, clause);
  }
  return [...result.values()].sort((left, right) => left.category.localeCompare(right.category) || left.title.localeCompare(right.title));
}

function makeClause(category: ClauseCategory, title: string, source: SourceReference, options: Partial<LegalClause>): LegalClause {
  const body = source.source_excerpt;
  const party = options.responsible_party ?? responsibleParty('', body);
  return {
    id: stableId('clause', `${category}|${body}`), category, title,
    summary: options.summary || body,
    full_text: options.full_text || body,
    source_page: source.source_page,
    source_excerpt: body,
    confidence: options.confidence ?? 79,
    risk_level: options.risk_level ?? riskFromText(body),
    responsible_party: party,
    obligation: options.obligation || obligationFromText(body, party),
    trigger: options.trigger || triggerFromText(body),
    deadline: options.deadline || deadlineFromText(body),
    financial_impact: options.financial_impact || moneyImpact(body),
    recommendation: options.recommendation || 'Review the source wording against the signed agreement.'
  };
}

function compareRisks(a: StructuredLegalRisk[], b: StructuredLegalRisk[]): ComparisonFinding[] {
  const result: ComparisonFinding[] = [];
  const aByRule = new Map(a.map((risk) => [risk.rule_id, risk]));
  const bByRule = new Map(b.map((risk) => [risk.rule_id, risk]));
  for (const [rule, after] of bByRule) {
    const before = aByRule.get(rule);
    if (!before) result.push(comparisonFinding('risk', 'Risk', '', `${after.severity}: ${after.title}`, emptySource(), riskSource(after), after.severity));
    else if (before.severity !== after.severity) result.push(comparisonFinding('risk', 'Risk severity', `${before.severity}: ${before.title}`, `${after.severity}: ${after.title}`, riskSource(before), riskSource(after), maxMateriality(before.severity, after.severity)));
  }
  for (const [rule, before] of aByRule) if (!bByRule.has(rule)) result.push(comparisonFinding('risk', 'Risk', `${before.severity}: ${before.title}`, '', riskSource(before), emptySource(), before.severity));
  return result;
}

function comparisonFinding(kind: ComparisonFinding['kind'], title: string, before: string, after: string, sourceA: SourceReference, sourceB: SourceReference, materiality: LegalRiskLevel): ComparisonFinding {
  return { id: stableId('comparison', `${kind}|${title}|${before}|${after}`), kind, category: title, title, before, after, source_reference_a: sourceA, source_reference_b: sourceB, materiality };
}

function sourceForCategory(result: LegalIntelligenceResult, title: string): SourceReference {
  const category = clauseCategory(title);
  return category ? clauseSource(result.clauses.find((clause) => clause.category === category)) : emptySource();
}

function financialValue(result: LegalIntelligenceResult, key: string): string {
  if (result.normalized_fields[key]) return result.normalized_fields[key];
  const clause = result.clauses.find((item) => ({ monthly_rental: 'Rental payment', security_deposit: 'Security deposit', utility_deposit: 'Utility deposit', access_card_deposit: 'Access card deposit', car_park_deposit: 'Car park deposit' }[key] === item.category));
  return clause?.financial_impact || firstMoney(clause?.full_text ?? '');
}

function dateValue(result: LegalIntelligenceResult, key: string): string {
  if (result.normalized_fields[key]) return result.normalized_fields[key];
  const match = result.executive_summary.match(key === 'commencement_date' ? /from (\d{2}\/\d{2}\/\d{4})/ : / to (\d{2}\/\d{2}\/\d{4})/);
  return match?.[1] ?? '';
}

function normalizedFields(facts: Facts): Record<string, string> {
  const financial = record(facts.financial);
  const tenancy = record(facts.tenancy);
  return {
    monthly_rental: money(financial.monthly_rental) ? formatMYR(money(financial.monthly_rental)) : '',
    security_deposit: money(financial.security_deposit) ? formatMYR(money(financial.security_deposit)) : '',
    utility_deposit: money(financial.utility_deposit) ? formatMYR(money(financial.utility_deposit)) : '',
    access_card_deposit: money(financial.access_card_deposit) ? formatMYR(money(financial.access_card_deposit)) : '',
    car_park_deposit: money(financial.car_park_deposit) ? formatMYR(money(financial.car_park_deposit)) : '',
    commencement_date: formatNexoraDate(text(tenancy.commencement_date)),
    expiry_date: formatNexoraDate(text(tenancy.expiry_date)),
    payment_due_day: text(tenancy.payment_due_day),
    renewal_option: text(tenancy.renewal_option),
    notice_period: text(tenancy.notice_period),
    termination: text(record(facts.legal).termination)
  };
}

function clauseText(result: LegalIntelligenceResult, category: ClauseCategory): string {
  return result.clauses.find((clause) => clause.category === category)?.summary ?? '';
}

function clauseDeadline(result: LegalIntelligenceResult, category: ClauseCategory): string {
  return result.clauses.find((clause) => clause.category === category)?.deadline ?? '';
}

function sourceForPattern(rawText: string, pattern: RegExp): SourceReference {
  const match = rawText.match(pattern);
  if (!match || match.index === undefined) return emptySource();
  const start = rawText.lastIndexOf('\n', match.index) + 1;
  const endIndex = rawText.indexOf('\n', match.index + match[0].length);
  const end = endIndex < 0 ? rawText.length : endIndex;
  const excerpt = rawText.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 500);
  return sourceReference(rawText, excerpt, null);
}

function sourceReference(rawText: string, preferred: string, sourcePage: number | null): SourceReference {
  const excerpt = preferred.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!excerpt) return emptySource();
  const index = rawText.toLowerCase().indexOf(excerpt.toLowerCase());
  return { source_page: Number.isInteger(sourcePage) && Number(sourcePage) > 0 ? Number(sourcePage) : pageForIndex(rawText, index), source_excerpt: excerpt };
}

function pageForIndex(rawText: string, index: number): number | null {
  if (index < 0) return null;
  let page: number | null = null;
  for (const marker of rawText.matchAll(/--- PAGE (\d+) ---/g)) {
    if ((marker.index ?? 0) > index) break;
    page = Number(marker[1]);
  }
  return page;
}

function clauseCategory(value: string): ClauseCategory | null {
  const normalized = value.toLowerCase().replace(/[_-]+/g, ' ').trim();
  return clauseCategories.find((category) => category.toLowerCase() === normalized)
    ?? clauseCategories.find((category) => normalized.includes(category.toLowerCase()) || category.toLowerCase().includes(normalized))
    ?? null;
}

function responsibleParty(value: string, body: string): ResponsibleParty {
  const normalized = `${value} ${body}`.toLowerCase();
  const tenant = /tenant|lessee|penyewa|租客/.test(normalized);
  const landlord = /landlord|lessor|owner|tuan rumah|业主|業主/.test(normalized);
  if (tenant && landlord) return 'both';
  if (tenant) return 'tenant';
  if (landlord) return 'landlord';
  return 'unclear';
}

function riskLevel(value: string): LegalRiskLevel {
  const normalized = value.toLowerCase();
  if (normalized === 'high' || normalized === 'critical') return 'high';
  if (normalized === 'medium') return 'medium';
  return 'low';
}

function riskFromText(value: string): LegalRiskLevel {
  if (/without\s+(?:notice|court)|sole discretion|forfeit|evict/i.test(value)) return 'high';
  if (/must|shall|penalty|interest|indemn/i.test(value)) return 'medium';
  return 'low';
}

function confidence(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed > 1 ? parsed : parsed * 100)) : 70;
}

function obligationFromText(value: string, party: ResponsibleParty): string {
  if (party === 'unclear') return '';
  const match = value.match(/(?:shall|must|agrees? to|responsible for)\s+([^.;]{3,220})/i);
  return match?.[1]?.trim() ?? '';
}

function triggerFromText(value: string): string {
  const match = value.match(/(?:upon|if|when|in the event of)\s+([^.;]{3,160})/i);
  return match?.[1]?.trim() ?? '';
}

function deadlineFromText(value: string): string {
  const match = value.match(/(?:on or before|within|not later than|by)\s+([^.;]{2,100})/i);
  return match?.[1]?.trim() ?? '';
}

function paymentDeadline(value: string): string {
  return value ? `${value.replace(/\D/g, '') || value} day of each month` : '';
}

function moneyImpact(value: string): string {
  return firstMoney(value);
}

function firstMoney(value: string): string {
  const match = value.match(/(?:RM|MYR)\s*([\d,]+(?:\.\d{1,2})?)/i);
  return match ? formatMYR(Number(match[1].replace(/,/g, ''))) : '';
}

function labelledMoneyValues(value: string, pattern: RegExp): number[] {
  return [...value.matchAll(pattern)].map((match) => Number(match[1].replace(/,/g, ''))).filter((amount) => Number.isFinite(amount));
}

function statedMonths(value: string, pattern: RegExp): number | null {
  const candidate = value.match(pattern)?.[1]?.toLowerCase() ?? '';
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
  const parsed = words[candidate] ?? Number(candidate);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasConflictingDates(value: string): boolean {
  const dates = [...value.matchAll(/(?:commencement|start|expiry|expiration|end)\s+date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/gi)].map((match) => match[1]);
  return new Set(dates).size > 2;
}

function money(value: unknown): number {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.map((value) => value.toFixed(2)))].map(Number);
}

function clauseKey(clause: LegalClause): string {
  return `${clause.category}|${normalize(clause.title)}`;
}

function normalizeClauseMeaning(clause: LegalClause): string {
  return normalize([clause.summary, clause.full_text, clause.responsible_party, clause.obligation, clause.deadline, clause.financial_impact].join('|'));
}

function clauseSource(clause: LegalClause | undefined): SourceReference {
  return clause ? { source_page: clause.source_page, source_excerpt: clause.source_excerpt } : emptySource();
}

function riskSource(risk: StructuredLegalRisk): SourceReference {
  return { source_page: risk.source_page, source_excerpt: risk.source_excerpt };
}

function emptySource(): SourceReference {
  return { source_page: null, source_excerpt: '' };
}

function materialityFor(title: string): LegalRiskLevel {
  return /rental|deposit|termination|expiry|commencement/i.test(title) ? 'high' : /renewal|notice/i.test(title) ? 'medium' : 'low';
}

function maxMateriality(left: LegalRiskLevel, right: LegalRiskLevel): LegalRiskLevel {
  return severityScore(left) >= severityScore(right) ? left : right;
}

function severityScore(value: LegalRiskLevel): number {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}

function titleFromReason(reason: string): string {
  return reason.split(/[.!?]/)[0].slice(0, 120) || 'Legal review required';
}

function stableId(prefix: string, value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function formatDate(value: string): string { return formatNexoraDate(value); }

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-MY', { maximumFractionDigits: 2 }).format(value);
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
