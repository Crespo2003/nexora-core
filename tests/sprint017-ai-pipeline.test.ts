import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractTenancyDocument, TenancyExtractionError } from '../lib/ai/extractTenancy';
import { parseOpenAiJsonObject } from '../lib/ai/openAiClient';

test('OpenAI response parser accepts strict JSON surrounded by markdown or explanatory text', () => {
  assert.deepEqual(
    parseOpenAiJsonObject('The requested record follows.\n```json\n{"tenant":{"name":"Aisha"},"monthly_rental":3500}\n```'),
    { tenant: { name: 'Aisha' }, monthly_rental: 3500 }
  );
  assert.deepEqual(
    parseOpenAiJsonObject('Extraction completed: {"document_type":"Residential","confidence":0.98} End of response.'),
    { document_type: 'Residential', confidence: 0.98 }
  );
  assert.throws(() => parseOpenAiJsonObject('No JSON object was returned.'), /No valid JSON object/);
});

test('unreadable text documents expose their precise parser stage and reason', async () => {
  await assert.rejects(
    extractTenancyDocument({ buffer: Buffer.from('too short'), filename: 'short.txt', mimeType: 'text/plain' }),
    (error: unknown) => {
      assert.ok(error instanceof TenancyExtractionError);
      assert.equal(error.stage, 'parser');
      assert.equal(error.code, 'text_extraction_failed');
      assert.match(error.message, /fewer than 80 readable characters/);
      return true;
    }
  );
});

test('upload route returns pipeline stage and actual extraction reason as JSON', () => {
  const route = readFileSync('app/api/tenancy-import/upload/route.ts', 'utf8');
  const diagnostics = readFileSync('lib/ai/extractionDiagnostics.ts', 'utf8');
  const client = readFileSync('lib/ai/openAiClient.ts', 'utf8');

  assert.match(route, /return uploadError\(failure\.error, failure\.stage, 422/);
  assert.match(route, /stage: 'pdf' \| 'ocr' \| 'openai' \| 'parser' \| 'mapping'/);
  assert.match(diagnostics, /rawOpenAiResponsePreview/);
  assert.match(diagnostics, /jsonParseResult/);
  assert.match(diagnostics, /mappedObjectPreview/);
  assert.match(client, /client\.responses\.create/);
  assert.match(client, /type: 'json_schema'/);
  assert.match(client, /strict: true/);
  assert.match(client, /parseOpenAiJsonObject/);
});
