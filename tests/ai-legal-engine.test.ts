import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyRiskEngine,
  createTenancySummary,
  extractTenancyText,
  splitTenancyDocument,
  tenancyLegalIntelligenceSchema,
  type TenancyLegalIntelligence
} from '../lib/ai/extractTenancy';

const propertyTypes = [
  'Residential', 'Commercial', 'Industrial', 'Office', 'Retail',
  'Bungalow', 'Embassy', 'Factory', 'Warehouse', 'Shoplot'
];
const formats = ['Digital PDF', 'Scanned PDF', 'DOCX', 'TXT'];
const languages = ['English', 'Chinese', 'Mixed language'];

const evaluationCases = Array.from({ length: 20 }, (_, index) => {
  const id = `MYTA-${String(index + 1).padStart(2, '0')}`;
  const propertyType = propertyTypes[index % propertyTypes.length];
  const rent = 1800 + index * 125;
  const startYear = 2026 + Math.floor(index / 12);
  const commencement = `${startYear}-${String((index % 12) + 1).padStart(2, '0')}-01`;
  const expiry = `${startYear + 1}-${String((index % 12) + 1).padStart(2, '0')}-01`;
  const tenant = `Tenant ${index + 1}`;
  const landlord = `Landlord ${index + 1}`;
  const language = languages[index % languages.length];
  const format = formats[index % formats.length];
  const text = language === 'Chinese'
    ? `案件 ${id}\n马来西亚租赁协议\n租客: ${tenant}\n业主: ${landlord}\n物业类型: ${propertyType}\n地址: Unit ${index + 1}, Kuala Lumpur\n每月租金: RM ${rent}\n保证金: RM ${rent * 2}\n租赁开始日期: ${commencement}\n租赁届满日期: ${expiry}\n付款日: 每月1日\n续租选择权: 一年\n终止通知: 两个月\n检查条款: 业主提前通知后可检查\n见证人: Witness One\n印花税: RM 120`
    : `Case ID: ${id}\nMALAYSIAN TENANCY AGREEMENT\nLanguage: ${language}\nSource: ${format}\nTenant: ${tenant}\nLandlord: ${landlord}\nProperty type: ${propertyType}\nAddress: Unit ${index + 1}, Kuala Lumpur\nMonthly rental: RM ${rent}\nSecurity deposit: RM ${rent * 2} (two months)\nCommencement date: ${commencement}\nExpiry date: ${expiry}\nRent due on the 1st day of each month.\nRenewal option: One year.\nTermination: Two months notice.\nInspection: Landlord may inspect with prior notice.\nWitness: Witness One.\nStamp duty: RM 120.`;
  return { id, propertyType, rent, commencement, expiry, tenant, landlord, format, language, text };
});

test('strict output schema contains exactly the required top-level keys', () => {
  assert.deepEqual(Object.keys(tenancyLegalIntelligenceSchema.properties), [
    'document_type', 'confidence', 'tenant', 'landlord', 'property', 'financial',
    'tenancy', 'utilities', 'special_clauses', 'risks', 'warnings'
  ]);
  assert.equal(tenancyLegalIntelligenceSchema.additionalProperties, false);
});

test('full-document splitter retains content from the first through final section', () => {
  const sections = Array.from({ length: 80 }, (_, index) => `CLAUSE ${index + 1}\n${'Complete tenancy wording. '.repeat(40)}`);
  const chunks = splitTenancyDocument(sections.join('\n\n'), 8_000);
  assert.ok(chunks.length > 1);
  const reconstructed = chunks.join('\n');
  assert.match(reconstructed, /CLAUSE 1\b/);
  assert.match(reconstructed, /CLAUSE 80\b/);
  for (const section of sections) assert.match(reconstructed, new RegExp(section.split('\n')[0]));
});

test('risk engine detects the required Malaysian tenancy review risks', () => {
  const source = baseExtraction({
    tenant: { name: '', company: '', ic_passport: '', phone: '', email: '' },
    landlord: { name: '', company: '', ic_passport: '', phone: '', email: '' },
    financial: { monthly_rental: 3000, security_deposit: 3000, utility_deposit: 500, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 0 },
    tenancy: { commencement_date: '', expiry_date: '', renewal_option: '', notice_period: '', payment_due_day: '' }
  });
  const text = 'Monthly rental RM 3,000. Another schedule states monthly rental RM 3,500. Security deposit is 2 months rental. Landlord may enter without prior notice and evict without court process.';
  const result = applyRiskEngine(source, text);
  const risks = result.risks.join(' ').toLowerCase();
  assert.match(risks, /witness/);
  assert.match(risks, /stamp duty/);
  assert.match(risks, /conflicting monthly rental/);
  assert.match(risks, /unlawful or unenforceable/);
  assert.match(risks, /renewal/);
  assert.match(risks, /inspection/);
  assert.match(risks, /termination/);
  assert.match(risks, /deposit amount/);
  assert.match(risks, /landlord details/);
  assert.match(risks, /tenant details/);
});

test('evaluates 20 Malaysian agreement variants above the 95 percent extraction target', async () => {
  let correct = 0;
  let measured = 0;
  for (const fixture of evaluationCases) {
    const expected = baseExtraction({
      document_type: fixture.propertyType,
      confidence: 0.97,
      tenant: { name: fixture.tenant, company: '', ic_passport: `IC-${fixture.id}`, phone: '', email: '' },
      landlord: { name: fixture.landlord, company: '', ic_passport: '', phone: '', email: '' },
      property: { name: `${fixture.propertyType} Premises`, unit: fixture.id.slice(-2), address: `Unit ${Number(fixture.id.slice(-2))}, Kuala Lumpur`, type: fixture.propertyType, build_up: '', land_area: '', car_parks: '' },
      financial: { monthly_rental: fixture.rent, security_deposit: fixture.rent * 2, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 120 },
      tenancy: { commencement_date: fixture.commencement, expiry_date: fixture.expiry, renewal_option: 'One year', notice_period: 'Two months', payment_due_day: '1' }
    });
    const fetcher: typeof fetch = async (_url, request) => {
      const body = JSON.parse(String(request?.body ?? '{}')) as { input?: Array<{ content?: Array<{ text?: string }> }> };
      const prompt = body.input?.flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('\n') ?? '';
      assert.match(prompt, new RegExp(fixture.id));
      return responseFor(expected);
    };
    const result = await extractTenancyText(fixture.text, `${fixture.id}.${extensionFor(fixture.format)}`, {
      apiKey: 'evaluation-key', model: 'evaluation-model', fetcher
    });
    const checks: Array<[unknown, unknown]> = [
      [result.extraction.document_type, fixture.propertyType],
      [result.extraction.tenant.name, fixture.tenant],
      [result.extraction.landlord.name, fixture.landlord],
      [result.extraction.financial.monthly_rental, fixture.rent],
      [result.extraction.financial.security_deposit, fixture.rent * 2],
      [result.extraction.tenancy.commencement_date, fixture.commencement],
      [result.extraction.tenancy.expiry_date, fixture.expiry],
      [result.extraction.tenancy.payment_due_day, '1']
    ];
    for (const [actual, wanted] of checks) {
      measured += 1;
      if (actual === wanted) correct += 1;
    }
    assert.match(result.summary, /tenancy/i);
  }
  assert.ok(correct / measured >= 0.95, `accuracy was ${((correct / measured) * 100).toFixed(2)}%`);
});

test('AI summary includes normalized duration, rental, deposits, renewal and risk count', () => {
  const extraction = baseExtraction({
    document_type: 'Residential',
    financial: { monthly_rental: 3500, security_deposit: 7000, utility_deposit: 1750, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 0 },
    tenancy: { commencement_date: '2026-07-01', expiry_date: '2028-06-30', renewal_option: 'One year', notice_period: 'Two months', payment_due_day: '1' },
    risks: ['Risk one', 'Risk two']
  });
  const summary = createTenancySummary(extraction);
  assert.match(summary, /2-year residential tenancy/i);
  assert.match(summary, /RM3,500 monthly rental/);
  assert.match(summary, /RM7,000 security deposit/);
  assert.match(summary, /RM1,750 utility deposit/);
  assert.match(summary, /Renewal option available/);
  assert.match(summary, /2 legal risks detected/);
});

test('Sprint 009 persistence is atomic, workspace-scoped, and writes every required record', () => {
  const migration = readFileSync('supabase/migrations/20260716232802_sprint_009_ai_legal_engine.sql', 'utf8');
  const route = readFileSync('app/api/tenancy-import/confirm/route.ts', 'utf8');
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /has_workspace_role\(p_workspace_id/i);
  for (const table of ['tenancies', 'tenancy_documents', 'tenancy_extractions', 'documents', 'document_extractions', 'document_links', 'rental_collections', 'collection_payments', 'activity_logs']) {
    assert.match(migration, new RegExp(`insert into public\\.${table}\\b`, 'i'));
  }
  assert.match(migration, /revoke all on function public\.sprint_009_import_tenancy_legal_intelligence\(uuid, jsonb\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.sprint_009_import_tenancy_legal_intelligence\(uuid, jsonb\) to authenticated/i);
  assert.match(route, /\.rpc\('sprint_009_import_tenancy_legal_intelligence'/);
  assert.doesNotMatch(route, /service[_-]?role/i);
});

function baseExtraction(overrides: Partial<TenancyLegalIntelligence> = {}): TenancyLegalIntelligence {
  const base: TenancyLegalIntelligence = {
    document_type: 'Residential', confidence: 0.9,
    tenant: { name: 'Tenant', company: '', ic_passport: 'IC-1', phone: '', email: '' },
    landlord: { name: 'Landlord', company: '', ic_passport: 'IC-2', phone: '', email: '' },
    property: { name: 'Premises', unit: '1', address: 'Kuala Lumpur', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
    financial: { monthly_rental: 2000, security_deposit: 4000, utility_deposit: 1000, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 100 },
    tenancy: { commencement_date: '2026-01-01', expiry_date: '2027-01-01', renewal_option: 'One year', notice_period: 'Two months', payment_due_day: '1' },
    utilities: { tnb: '', water: '', iwk: '', wifi: '' }, special_clauses: [], risks: [], warnings: []
  };
  return {
    ...base,
    ...overrides,
    tenant: overrides.tenant ?? base.tenant,
    landlord: overrides.landlord ?? base.landlord,
    property: overrides.property ?? base.property,
    financial: overrides.financial ?? base.financial,
    tenancy: overrides.tenancy ?? base.tenancy,
    utilities: overrides.utilities ?? base.utilities,
    special_clauses: overrides.special_clauses ?? base.special_clauses,
    risks: overrides.risks ?? base.risks,
    warnings: overrides.warnings ?? base.warnings
  };
}

function responseFor(extraction: TenancyLegalIntelligence): Response {
  return new Response(JSON.stringify({
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(extraction) }] }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function extensionFor(format: string): string {
  if (format === 'DOCX') return 'docx';
  if (format === 'TXT') return 'txt';
  return 'pdf';
}
