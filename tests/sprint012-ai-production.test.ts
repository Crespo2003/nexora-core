import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getOpenAiConfiguration } from '../lib/ai/openAiConfig';
import { extractTenancyDetails } from '../lib/tenancy/parser';

const readableText = `${'Complete Malaysian tenancy agreement clause. '.repeat(8)} Tenant: Example Tenant`;

test('OpenAI configuration requires only a usable server API key and defaults optional models', () => {
  assert.deepEqual(getOpenAiConfiguration({}), {
    configured: false,
    keyPresent: false,
    tenancyModel: 'gpt-5.5',
    ocrModel: 'gpt-4.1-mini',
    reason: 'openai_not_configured'
  });
  assert.deepEqual(getOpenAiConfiguration({ OPENAI_API_KEY: 'sk-proj-production-key-with-safe-length' }), {
    configured: true,
    keyPresent: true,
    tenancyModel: 'gpt-5.5',
    ocrModel: 'gpt-4.1-mini',
    reason: 'configured'
  });
  assert.equal(getOpenAiConfiguration({
    OPENAI_API_KEY: 'sk-proj-production-key-with-safe-length',
    OPENAI_TENANCY_MODEL: 'custom-tenancy-model',
    OPENAI_OCR_MODEL: 'custom-ocr-model'
  }).configured, true);
  assert.equal(getOpenAiConfiguration({ OPENAI_API_KEY: 'x' }).configured, true);
});

test('server runtime key always executes the OpenAI path, including safely quoted Vercel values', async () => {
  const previous = process.env.OPENAI_API_KEY;
  let called = false;
  process.env.OPENAI_API_KEY = '"runtime-secret-value"';
  try {
    const extraction = await extractTenancyDetails(readableText, 'runtime-key.txt', 'text/plain', {
      fetcher: async () => {
        called = true;
        return responseFor(validExtraction());
      }
    });
    assert.equal(called, true);
    assert.equal(extraction.provider, 'openai');
    assert.equal(extraction.fallbackReason, null);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('successful structured extraction reports OpenAI provider and low-confidence fields', async () => {
  const extraction = await extractTenancyDetails(readableText, 'agreement.txt', 'text/plain', {
    apiKey: 'mock-key',
    model: 'gpt-5.5',
    fetcher: async () => responseFor(validExtraction())
  });
  assert.equal(extraction.provider, 'openai');
  assert.equal(extraction.fallbackUsed, false);
  assert.equal(extraction.fallbackReason, null);
  assert.equal(extraction.document.model, 'gpt-5.5');
  assert.equal(extraction.tenant.name.confidence, 'medium');
});

test('timeouts and invalid AI responses produce precise deterministic fallback reasons', async () => {
  const timeout = await extractTenancyDetails(readableText, 'timeout.txt', 'text/plain', {
    apiKey: 'mock-key', fetcher: async () => { throw new DOMException('timeout', 'AbortError'); }
  });
  assert.equal(timeout.provider, 'deterministic');
  assert.equal(timeout.advancedAiConfigured, true);
  assert.equal(timeout.fallbackReason, 'openai_timeout');

  const invalid = await extractTenancyDetails(readableText, 'invalid.txt', 'text/plain', {
    apiKey: 'mock-key', fetcher: async () => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '{}' }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  assert.equal(invalid.provider, 'deterministic');
  assert.equal(invalid.fallbackReason, 'openai_schema_mismatch');
});

test('provider authentication errors are never reported as missing configuration', async () => {
  const extraction = await extractTenancyDetails(readableText, 'invalid-key.txt', 'text/plain', {
    apiKey: 'present-but-invalid-key',
    fetcher: async () => new Response(JSON.stringify({
      error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' }
    }), { status: 401, headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_test' } })
  });
  assert.equal(extraction.provider, 'deterministic');
  assert.equal(extraction.advancedAiConfigured, true);
  assert.equal(extraction.fallbackReason, 'openai_authentication_failed');
});

test('missing API key is the only unconfigured fallback condition', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await extractTenancyDetails(readableText, 'missing-key.txt', 'text/plain');
    assert.equal(result.advancedAiConfigured, false);
    assert.equal(result.fallbackReason, 'openai_not_configured');
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('production route contract, file paths, UI provider state, isolation and retry safety are enforced', () => {
  const route = readFileSync('lib/tenancy/tenancyUploadHandler.ts', 'utf8');
  const configRoute = readFileSync('app/api/tenancy-import/config-status/route.ts', 'utf8');
  const textExtraction = readFileSync('lib/documents/extractText.ts', 'utf8');
  const ui = readFileSync('app/rental-command-centre.tsx', 'utf8');
  const client = readFileSync('lib/ai/openAiClient.ts', 'utf8');
  assert.match(route, /success: true[\s\S]*provider:[\s\S]*fallbackUsed:[\s\S]*fallbackReason:[\s\S]*documentId:[\s\S]*summary:[\s\S]*risks:[\s\S]*warnings:[\s\S]*confidence:/);
  assert.match(textExtraction, /mimeType === 'application\/pdf'/);
  assert.match(textExtraction, /wordprocessingml\.document/);
  assert.match(textExtraction, /mimeType === 'text\/plain'/);
  assert.match(textExtraction, /ocrProvider\.extractText/);
  assert.match(ui, /AI extraction completed successfully\. Provider: OpenAI/);
  assert.match(ui, /Deterministic fallback used\. Reason:/);
  assert.doesNotMatch(ui, /Advanced AI extraction is not configured yet/);
  assert.match(configRoute, /requireWorkspaceAccess/);
  assert.match(route, /\.eq\('workspace_id', workspaceId\)\.eq\('document_hash', documentHash\)/);
  assert.match(route, /retryableDocumentStatuses = \['ocr_required', 'extraction_failed'\]/);
  assert.doesNotMatch(client, /NEXT_PUBLIC_OPENAI|dangerouslyAllowBrowser:\s*true/);
});

function responseFor(extraction: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    status: 'completed',
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(extraction) }] }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function validExtraction(): Record<string, unknown> {
  return {
    document: { type: 'Residential', language: 'English', summary: '' }, confidence: 0.7,
    tenant: { name: 'Example Tenant', company: '', identification: '', phone: '', email: '' },
    landlord: { name: '', company: '', identification: '', phone: '', email: '' },
    property: { name: '', unit_number: '', address: '', property_type: 'Residential', build_up: '', land_area: '', car_parks: '' },
    financial: { monthly_rental: 0, security_deposit: 0, utility_deposit: 0, access_card_deposit: 0, car_park_deposit: 0, stamp_duty: 0 },
    tenancy: { commencement_date: '', expiry_date: '', renewal_option: '', notice_period: '', payment_due_day: '' },
    utilities: { tnb: '', water: '', iwk: '', wifi: '' },
    legal: { signatures: '', witnesses: '', stamp_duty: '', inventory: '', restrictions: [], late_payment: '', termination: '', viewing_rights: '', insurance: '', maintenance: '', access_card: '', car_park: '' },
    clauses: [], risks: [], warnings: []
  };
}
