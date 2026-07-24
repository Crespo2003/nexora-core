import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createTenancyUploadHandler } from '../lib/tenancy/tenancyUploadHandler';
import { mapTenancyExtractionToForm } from '../lib/tenancy/mapTenancyExtractionToForm';

const workspaceId = 'workspace-duplicate-test';
const agreementText = 'MALAYSIAN TENANCY AGREEMENT\nTenant: Existing Tenant\nLandlord: Existing Landlord\nMonthly rental: RM 3500\nSecurity deposit: RM 7000\nCommencement date: 2026-07-01\nExpiry date: 2028-06-30';
const agreementHash = createHash('sha256').update(agreementText).digest('hex');

test('a duplicate document reuses its latest valid extraction and does not write another record', async () => {
  const calls = { storageUploads: 0, extraction: 0, rpc: 0 };
  const handler = duplicateHandler({
    document: completedDocument(),
    extraction: completedExtraction(),
    link: { entity_id: 'tenancy-existing' },
    calls,
    extract: async () => {
      calls.extraction += 1;
      throw new Error('A stored extraction should be reused before AI extraction runs.');
    }
  });

  const response = await post(handler);
  assert.equal(response.status, 200);
  const payload = await response.json() as Record<string, any>;
  assert.deepEqual({
    success: payload.success,
    reused: payload.reused,
    documentId: payload.documentId,
    extractionId: payload.extractionId,
    tenancyId: payload.tenancyId,
    warnings: payload.warnings
  }, {
    success: true,
    reused: true,
    documentId: 'document-existing',
    extractionId: 'extraction-existing',
    tenancyId: 'tenancy-existing',
    warnings: ['Existing document reused']
  });
  assert.equal(mapTenancyExtractionToForm(payload.extraction, { workspaceId }).monthlyRental, 3500);
  assert.equal(mapTenancyExtractionToForm(payload.extraction, { workspaceId }).tenantName, 'Existing Tenant');
  assert.deepEqual(calls, { storageUploads: 0, extraction: 0, rpc: 0 });
});

test('a failed duplicate retries against its existing document without another storage upload or database write', async () => {
  const calls = { storageUploads: 0, extraction: 0, rpc: 0 };
  const handler = duplicateHandler({
    document: { ...completedDocument(), processing_status: 'extraction_failed' },
    extraction: null,
    link: null,
    calls,
    extract: async () => {
      calls.extraction += 1;
      return extractedFromRetry();
    }
  });

  const response = await post(handler);
  assert.equal(response.status, 200);
  const payload = await response.json() as Record<string, any>;
  assert.deepEqual({
    success: payload.success,
    reused: payload.reused,
    documentId: payload.documentId,
    extractionId: payload.extractionId,
    tenancyId: payload.tenancyId,
    warnings: payload.warnings,
    storagePath: payload.document.storagePath
  }, {
    success: true,
    reused: true,
    documentId: 'document-existing',
    extractionId: '',
    tenancyId: '',
    warnings: ['Existing document reused'],
    storagePath: 'workspace-duplicate-test/tenancy-agreements/existing-agreement.txt'
  });
  assert.equal(calls.storageUploads, 0);
  assert.equal(calls.extraction, 1);
  assert.equal(calls.rpc, 0);
});

test('a failed retry preserves the existing document rather than creating a duplicate upload', async () => {
  const calls = { storageUploads: 0, extraction: 0, rpc: 0 };
  let preservationPayload: Record<string, any> | null = null;
  const handler = duplicateHandler({
    document: { ...completedDocument(), processing_status: 'extraction_failed' },
    extraction: null,
    link: null,
    calls,
    extract: async () => {
      calls.extraction += 1;
      const error = new Error('OCR provider timed out') as Error & { code: string };
      error.code = 'ocr_provider_timeout';
      throw error;
    },
    onRpc: (arguments_) => {
      preservationPayload = arguments_.p_payload;
    }
  });

  const response = await post(handler);
  assert.equal(response.status, 422);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.code, 'ocr_provider_timeout');
  assert.equal(calls.storageUploads, 0);
  assert.equal(calls.extraction, 1);
  assert.equal(calls.rpc, 1);
  assert.equal(preservationPayload?.storagePath, 'workspace-duplicate-test/tenancy-agreements/existing-agreement.txt');
  assert.equal(preservationPayload?.documentHash, agreementHash);
});

function duplicateHandler(options: {
  document: Record<string, unknown>;
  extraction: Record<string, unknown> | null;
  link: Record<string, unknown> | null;
  calls: { storageUploads: number; extraction: number; rpc: number };
  extract: () => Promise<any>;
  onRpc?: (arguments_: Record<string, any>) => void;
}) {
  const supabase = {
    from: (table: string) => ({
      select: () => queryFor(table, options)
    }),
    storage: {
      from: () => ({
        upload: async () => {
          options.calls.storageUploads += 1;
          return { data: { path: 'unexpected-new-upload' }, error: null };
        },
        remove: async () => ({ error: null })
      })
    },
    rpc: async (_name: string, arguments_: Record<string, any>) => {
      options.calls.rpc += 1;
      options.onRpc?.(arguments_);
      return { data: { document: { id: 'document-existing' }, extraction: { id: 'extraction-existing' } }, error: null };
    }
  };

  return createTenancyUploadHandler({
    extractTenancyFile: options.extract as never,
    requireWorkspaceAccess: async () => ({ supabase, user: { id: 'user-test' }, workspaceId, role: 'owner' }) as never,
    workspaceStoragePath: () => 'workspace-duplicate-test/tenancy-agreements/should-not-be-created.txt',
    getOpenAiConfiguration: () => ({ configured: true, apiKey: 'test-key', tenancyModel: 'gpt-5.5' }) as never
  });
}

function queryFor(table: string, options: Parameters<typeof duplicateHandler>[0]) {
  const data = table === 'documents'
    ? options.document
    : table === 'document_extractions'
      ? options.extraction
      : table === 'document_links'
        ? options.link
        : null;
  const query = {
    eq: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data, error: null })
  };
  return query;
}

async function post(handler: ReturnType<typeof createTenancyUploadHandler>) {
  const body = new FormData();
  body.append('file', new File([agreementText], 'existing-agreement.txt', { type: 'text/plain' }));
  return handler(new Request('https://nexora.test/api/tenancy-import/upload', { method: 'POST', body }));
}

function completedDocument() {
  return {
    id: 'document-existing',
    processing_status: 'extraction_completed',
    original_filename: 'existing-agreement.txt',
    sanitized_filename: 'existing-agreement.txt',
    storage_path: 'workspace-duplicate-test/tenancy-agreements/existing-agreement.txt',
    mime_type: 'text/plain',
    file_size: agreementText.length,
    document_type: 'tenancy_agreement',
    upload_status: 'uploaded',
    document_hash: agreementHash
  };
}

function completedExtraction() {
  return {
    id: 'extraction-existing',
    raw_text: agreementText,
    extracted_json: legalIntelligence(),
    confidence_json: {},
    ai_summary: 'Existing tenancy extraction.',
    ai_model: 'gpt-5.5',
    extraction_engine: 'openai',
    extraction_status: 'extraction_completed',
    created_at: '2026-07-18T00:00:00.000Z'
  };
}

function extractedFromRetry() {
  return {
    rawText: agreementText,
    summary: 'Retried tenancy extraction.',
    provider: 'openai' as const,
    fallbackUsed: false,
    fallbackReason: null,
    document: {
      originalFilename: 'existing-agreement.txt',
      documentType: 'tenancy_agreement',
      usedOcr: false,
      pageCount: null,
      model: 'gpt-5.5',
      chunkCount: 1
    },
    legalIntelligence: legalIntelligence()
  };
}

function legalIntelligence() {
  return {
    document_type: 'Residential',
    confidence: 0.95,
    tenant: { name: 'Existing Tenant', company: '', ic_passport: '', phone: '', email: '' },
    landlord: { name: 'Existing Landlord', company: '', ic_passport: '', phone: '', email: '' },
    property: { name: 'Existing Residence', unit: 'A-1', address: 'Kuala Lumpur', type: 'Residential', build_up: '', land_area: '', car_parks: '' },
    financial: { monthly_rental: 3500, security_deposit: 7000, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 350 },
    tenancy: { commencement_date: '2026-07-01', expiry_date: '2028-06-30', renewal_option: '', notice_period: '2 months', payment_due_day: '1' },
    utilities: { tnb: '', water: '', iwk: '', wifi: '' },
    legal: { signatures: '', witnesses: '', stamp_duty: 'RM 350', inventory: '', restrictions: [], late_payment: '', termination: '2 months', viewing_rights: '', insurance: '', maintenance: '', access_card: '', car_park: '' },
    clauses: [],
    special_clauses: [],
    risks: [],
    warnings: [],
    field_confidence: {},
    field_evidence: {}
  };
}
