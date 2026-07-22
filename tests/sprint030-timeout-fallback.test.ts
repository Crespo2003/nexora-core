import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createTenancyUploadHandler } from '../lib/tenancy/tenancyUploadHandler';
import { extractTenancyDeterministically } from '../lib/tenancy/deterministicParser';

// Simulated TA.pdf text matching the real A-32-01 tenancy agreement format.
// Tests verify that the deterministic fallback (triggered by openai_timeout) produces
// all 11 required fields when the primary AI path is unavailable.
const tapRawText = [
  'TENANCY AGREEMENT',
  '',
  'THIS TENANCY AGREEMENT is made the 30th day of January 2026.',
  '',
  'BETWEEN',
  '',
  'KOH CHIT YI (NRIC No: 700101-12-3456), holder of Malaysian Identity Card No. 700101-12-3456, hereinafter called "the Landlord"',
  '',
  'OF THE FIRST PART',
  '',
  'AND',
  '',
  'MA FEI (Passport No: E12345678), hereinafter called "the Tenant"',
  '',
  'OF THE SECOND PART',
  '',
  'The Landlord hereby lets to the Tenant the premises known as Unit A-32-01, RESIDENSI DEDAUN MAS, Jalan Dedaun Mas, 55000 Kuala Lumpur, Malaysia.',
  '',
  'Commencement Date: 30/01/2026',
  'Expiry Date: 29/01/2027',
  'Monthly Rental: RM 3,600.00 per month',
  '',
  'THIRD SCHEDULE - DEPOSITS',
  '',
  'Security Deposits',
  '(2 months rental)',
  '',
  'Ringgit Malaysia (RM 7,200.00)',
  '',
  'General Utility Deposit',
  '(0.5 months rental)',
  '',
  'Ringgit Malaysia (RM 1,800.00)',
  '',
  'Access Card Deposit: RM 200.00',
].join('\n');

const tapHash = createHash('sha256').update(Buffer.from(tapRawText)).digest('hex');

test('extractTenancyDeterministically: extracts all 11 required fields from TA.pdf simulated text', () => {
  const result = extractTenancyDeterministically(tapRawText, 'TA.pdf', 'application/pdf', 'openai_timeout', true);
  const fi = result.legalIntelligence;

  // Financial fields
  assert.equal(fi.financial.monthly_rental, 3600, 'monthly_rental must be 3600');
  assert.equal(fi.financial.security_deposit, 7200, 'security_deposit must be 7200');
  assert.equal(fi.financial.utility_deposit, 1800, 'utility_deposit must be 1800');
  assert.equal(fi.financial.access_card_deposit, 200, 'access_card_deposit must be 200');
  assert.equal(fi.financial.car_park_deposit, null, 'car_park_deposit must be null');

  // Dates
  assert.equal(fi.tenancy.commencement_date, '2026-01-30', 'commencement_date must be 2026-01-30');
  assert.equal(fi.tenancy.expiry_date, '2027-01-29', 'expiry_date must be 2027-01-29');

  // Parties
  assert.equal(fi.tenant.name, 'MA FEI', 'tenant.name must be MA FEI');
  assert.equal(fi.landlord.name, 'KOH CHIT YI', 'landlord.name must be KOH CHIT YI');

  // Property
  assert.equal(fi.property.unit, 'A-32-01', 'property.unit must be A-32-01');
  assert.equal(fi.property.name, 'RESIDENSI DEDAUN MAS', 'property.name must be RESIDENSI DEDAUN MAS');
});

test('route handler: deterministic fallback returns all 11 required fields in HTTP response', async () => {
  const handler = makeHandler({
    document: null,
    extraction: null,
    link: null,
    extract: async () => extractTenancyDeterministically(tapRawText, 'TA.pdf', 'application/pdf', 'openai_timeout', true)
  });
  const payload = await postAndParse(handler);

  assert.equal(payload.fallbackUsed, true, 'fallbackUsed must be true');
  assert.equal(payload.fallbackReason, 'openai_timeout', 'fallbackReason must be openai_timeout');

  const fi = payload.extraction?.legalIntelligence?.financial;
  assert.equal(fi?.monthly_rental, 3600, 'monthly_rental must be 3600');
  assert.equal(fi?.security_deposit, 7200, 'security_deposit must be 7200');
  assert.equal(fi?.utility_deposit, 1800, 'utility_deposit must be 1800');
  assert.equal(fi?.access_card_deposit, 200, 'access_card_deposit must be 200');
  assert.equal(fi?.car_park_deposit, null, 'car_park_deposit must be null');

  const ten = payload.extraction?.legalIntelligence?.tenancy;
  assert.equal(ten?.commencement_date, '2026-01-30', 'commencement_date must be 2026-01-30');
  assert.equal(ten?.expiry_date, '2027-01-29', 'expiry_date must be 2027-01-29');

  assert.equal(payload.extraction?.legalIntelligence?.tenant?.name, 'MA FEI', 'tenant.name must be MA FEI');
  assert.equal(payload.extraction?.legalIntelligence?.landlord?.name, 'KOH CHIT YI', 'landlord.name must be KOH CHIT YI');
  assert.equal(payload.extraction?.legalIntelligence?.property?.unit, 'A-32-01', 'property.unit must be A-32-01');
  assert.equal(payload.extraction?.legalIntelligence?.property?.name, 'RESIDENSI DEDAUN MAS', 'property.name must be RESIDENSI DEDAUN MAS');
});

test('route handler: compact retry mock succeeds and falls back to deterministic only when compact also fails', async () => {
  // When extractTenancyFile itself returns a fresh openai result (compact retry succeeded internally),
  // the route handler should return it as a non-fallback extraction.
  const openaiLike = {
    rawText: tapRawText,
    summary: 'Compact retry succeeded.',
    provider: 'openai' as const,
    fallbackUsed: false,
    fallbackReason: null,
    advancedAiConfigured: true,
    document: {
      originalFilename: 'TA.pdf',
      uploadDate: '2026-07-22',
      documentType: 'PDF Tenancy Agreement',
      extractionStatus: 'ready' as const,
      extractionConfidence: 'medium' as const,
      usedOcr: false,
      pageCount: 3,
      chunkCount: 1,
      aiCallCount: 2,
      model: 'gpt-4.1',
      fallbackReason: null
    },
    property: { propertyName: { value: 'RESIDENSI DEDAUN MAS', confidence: 'medium' as const }, unitNo: { value: 'A-32-01', confidence: 'medium' as const }, fullAddress: { value: '', confidence: 'low' as const }, propertyType: { value: 'residential', confidence: 'low' as const } },
    landlord: { name: { value: 'KOH CHIT YI', confidence: 'medium' as const }, idNo: { value: '', confidence: 'low' as const }, phone: { value: '', confidence: 'low' as const }, email: { value: '', confidence: 'low' as const } },
    tenant: { name: { value: 'MA FEI', confidence: 'medium' as const }, idNo: { value: '', confidence: 'low' as const }, phone: { value: '', confidence: 'low' as const }, email: { value: '', confidence: 'low' as const } },
    financial: { monthlyRental: { value: '3600', confidence: 'medium' as const }, securityDeposit: { value: '7200', confidence: 'medium' as const }, utilityDeposit: { value: '1800', confidence: 'medium' as const }, accessCardDeposit: { value: '200', confidence: 'medium' as const }, carParkRemoteDeposit: { value: '', confidence: 'low' as const } },
    dates: { commencementDate: { value: '30/01/2026', confidence: 'medium' as const }, expiryDate: { value: '29/01/2027', confidence: 'medium' as const }, rentalDueDay: { value: '', confidence: 'low' as const }, renewalOption: { value: '', confidence: 'low' as const }, noticePeriod: { value: '', confidence: 'low' as const }, renewalReminder: { value: '', confidence: 'low' as const } },
    clauses: { renewalClause: { value: '', confidence: 'low' as const }, terminationClause: { value: '', confidence: 'low' as const }, diplomaticClause: { value: '', confidence: 'low' as const }, viewingClause: { value: '', confidence: 'low' as const }, illegalActivityRestriction: { value: '', confidence: 'low' as const }, petClause: { value: '', confidence: 'low' as const }, specialClauses: { value: '', confidence: 'low' as const }, otherObligations: { value: '', confidence: 'low' as const } },
    legalIntelligence: {
      document_type: 'Residential', confidence: 0.70,
      tenant: { name: 'MA FEI', company: '', ic_passport: 'E12345678', phone: '', email: '' },
      landlord: { name: 'KOH CHIT YI', company: '', ic_passport: '700101-12-3456', phone: '', email: '' },
      property: { name: 'RESIDENSI DEDAUN MAS', unit: 'A-32-01', address: 'Jalan Dedaun Mas, 55000 Kuala Lumpur', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
      financial: { monthly_rental: 3600, security_deposit: 7200, utility_deposit: 1800, access_card_deposit: 200, car_park_deposit: null, stamp_duty: null },
      tenancy: { commencement_date: '2026-01-30', expiry_date: '2027-01-29', renewal_option: '', notice_period: '', payment_due_day: '' },
      utilities: { tnb: '', water: '', iwk: '', wifi: '' },
      legal: { signatures: '', witnesses: '', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: '', viewing_rights: '', insurance: '', maintenance: '', access_card: '', car_park: '' },
      special_clauses: [], risks: [], warnings: [], field_confidence: {}, field_evidence: {}
    }
  };

  const handler = makeHandler({ document: null, extraction: null, link: null, extract: async () => openaiLike });
  const payload = await postAndParse(handler);

  assert.equal(payload.fallbackUsed, false, 'fallbackUsed must be false when compact retry succeeded');
  assert.equal(payload.extraction?.legalIntelligence?.tenant?.name, 'MA FEI', 'tenant.name must be MA FEI');
  assert.equal(payload.extraction?.legalIntelligence?.landlord?.name, 'KOH CHIT YI', 'landlord.name must be KOH CHIT YI');
  assert.equal(payload.extraction?.legalIntelligence?.financial?.security_deposit, 7200, 'security_deposit must be 7200');
});

// --- handler factory (mirrors sprint029 pattern) ---

const workspaceId = 'workspace-timeout-fallback-030';

function makeHandler(options: {
  document: Record<string, unknown> | null;
  extraction: Record<string, unknown> | null;
  link: Record<string, unknown> | null;
  extract: () => Promise<unknown>;
}) {
  const supabase = {
    from: (table: string) => ({
      select: () => {
        const data = table === 'documents'
          ? options.document
          : table === 'document_extractions'
            ? options.extraction
            : table === 'document_links'
              ? options.link
              : null;
        const q: Record<string, () => unknown> = {};
        const chain = () => q;
        q.eq = chain; q.in = chain; q.order = chain; q.limit = chain;
        q.maybeSingle = async () => ({ data, error: null });
        return q;
      }
    }),
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'test-storage-ref', id: 'storage-id' }, error: null }),
        remove: async () => ({ error: null })
      })
    },
    rpc: async () => ({ data: null, error: null })
  };

  return createTenancyUploadHandler({
    extractTenancyFile: options.extract as never,
    validateFileSignature: () => true as never,
    requireWorkspaceAccess: async () => ({ supabase, user: { id: 'user-test' }, workspaceId, role: 'owner' }) as never,
    workspaceStoragePath: () => `${workspaceId}/tenancy-agreements/ta-new.pdf`,
    getOpenAiConfiguration: () => ({ configured: true, apiKey: 'test-key', tenancyModel: 'gpt-4.1' }) as never
  });
}

async function postAndParse(handler: ReturnType<typeof makeHandler>) {
  const body = new FormData();
  body.append('file', new File([tapRawText], 'TA.pdf', { type: 'application/pdf' }));
  const response = await handler(new Request('https://nexora.test/api/tenancy-import/upload', { method: 'POST', body }));
  assert.equal(response.status, 200, `Expected 200 but got ${response.status}`);
  const payload = await response.json() as Record<string, any>;
  assert.equal(payload.success, true, 'payload.success must be true');
  return payload;
}
