import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readJsonApiResponse } from '../lib/http/jsonResponse';

test('tenancy import clients accept JSON responses', async () => {
  const payload = await readJsonApiResponse(new Response(JSON.stringify({ success: true, extraction: {} }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  }));
  assert.deepEqual(payload, { success: true, extraction: {} });
});

test('tenancy import clients surface a stable error for platform plain-text failures', async () => {
  await assert.rejects(
    () => readJsonApiResponse(new Response('An error occurred while loading the function.', { status: 500, headers: { 'Content-Type': 'text/plain' } })),
    /non-json-api-response/
  );
});

test('tenancy import clients surface a stable error for malformed JSON', async () => {
  await assert.rejects(
    () => readJsonApiResponse(new Response('{not-json', { status: 500, headers: { 'Content-Type': 'application/json' } })),
    /invalid-json-api-response/
  );
});

test('all tenancy import endpoint exits return NextResponse JSON payloads', () => {
  const upload = readFileSync('lib/tenancy/tenancyUploadHandler.ts', 'utf8');
  const uploadRoute = readFileSync('app/api/tenancy-import/upload/route.ts', 'utf8');
  const config = readFileSync('app/api/tenancy-import/config-status/route.ts', 'utf8');
  const confirm = readFileSync('app/api/tenancy-import/confirm/route.ts', 'utf8');
  for (const source of [upload, config, confirm]) {
    assert.doesNotMatch(source, /new Response\(|return\s+auth;|return\s+requestSizeError;/);
    assert.match(source, /NextResponse\.json\(/);
  }
  assert.match(upload, /createTenancyUploadHandler/);
  assert.match(upload, /normalizeGuardResponse\(requestSizeError, 'validation'\)/);
  assert.match(upload, /normalizeGuardResponse\(auth, 'auth'\)/);
  assert.match(confirm, /await auth\.clone\(\)\.json\(\)/);
  assert.match(config, /await auth\.clone\(\)\.json\(\)/);
  assert.match(uploadRoute, /export const runtime = 'nodejs'/);
});

test('the tenancy import UI never invokes Response.json directly for upload or confirmation', () => {
  const ui = readFileSync('app/rental-command-centre.tsx', 'utf8');
  assert.match(ui, /readJsonApiResponse\(response\)/);
  assert.doesNotMatch(ui, /const payload = await response\.json\(\);\s*\n\s*if \(!response\.ok \|\| !payload\.extraction\)/);
});

test('every OpenAI production call is caught and logs a safe server-side diagnostic', () => {
  const client = readFileSync('lib/ai/openAiClient.ts', 'utf8');
  const ocr = readFileSync('lib/ocr/openAiOcr.ts', 'utf8');
  const commercial = readFileSync('lib/commercial/aiExplanation.ts', 'utf8');
  const property = readFileSync('lib/property-intelligence/analysis.ts', 'utf8');
  const diagnostics = readFileSync('lib/ai/extractionDiagnostics.ts', 'utf8');
  assert.match(client, /try\s*\{[\s\S]*?client\.responses\.create\(/);
  assert.match(ocr, /try\s*\{[\s\S]*?client\.responses\.create\(/);
  assert.match(commercial, /try\s*\{[\s\S]*?fetch\('https:\/\/api\.openai\.com/);
  assert.match(property, /try\s*\{[\s\S]*?fetch\('https:\/\/api\.openai\.com/);
  assert.match(client, /logOpenAiError\('request_error'/);
  assert.match(ocr, /logOpenAiError\('ocr_error'/);
  assert.match(diagnostics, /console\.error\('\[tenancy-extraction\]'/);
  assert.match(diagnostics, /Bearer \[redacted\]/);
});
