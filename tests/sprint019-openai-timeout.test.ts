import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { requestStructuredOpenAi } from '../lib/ai/openAiClient';
import { OpenAiOcrProvider } from '../lib/ocr/openAiOcr';

test('the tenancy upload allows a 120-second OpenAI request and retries it once', () => {
  const handler = readFileSync('lib/tenancy/tenancyUploadHandler.ts', 'utf8');
  assert.match(handler, /timeoutMs: 120_000/);
  assert.match(handler, /maxAttempts: 2/);
  assert.doesNotMatch(handler, /timeoutMs: 75_000|maxAttempts: 1/);
});

test('a slow first OpenAI attempt is retried before the caller receives a failure', async () => {
  let calls = 0;
  const result = await requestStructuredOpenAi({
    apiKey: 'synthetic-key',
    model: 'gpt-5.5',
    schemaName: 'timeout_retry_test',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['accepted'],
      properties: { accepted: { type: 'boolean' } }
    },
    system: 'Return the requested JSON object.',
    prompt: 'Return accepted as true.',
    timeoutMs: 120_000,
    maxAttempts: 2,
    fetcher: async () => {
      calls += 1;
      if (calls === 1) throw new DOMException('Synthetic slow request', 'TimeoutError');
      return new Response(JSON.stringify({ output_text: '{"accepted":true}' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    },
    validate: (value) => {
      assert.deepEqual(value, { accepted: true });
      return value as { accepted: boolean };
    }
  });

  assert.deepEqual(result, { accepted: true });
  assert.equal(calls, 2);
});

test('a slow OCR attempt receives the full timeout and is retried once before failing', async () => {
  let calls = 0;
  const provider = new OpenAiOcrProvider('synthetic-key', 'gpt-4.1-mini', async () => {
    calls += 1;
    if (calls === 1) throw new DOMException('Synthetic OCR timeout', 'TimeoutError');
    return new Response(JSON.stringify({ output_text: 'FULL TENANCY AGREEMENT TEXT', status: 'completed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  const result = await provider.extractText({
    buffer: Buffer.from('%PDF-1.7\nsynthetic'),
    mimeType: 'application/pdf',
    filename: 'scanned-tenancy.pdf'
  });

  assert.deepEqual(result, { status: 'completed', text: 'FULL TENANCY AGREEMENT TEXT', error: '' });
  assert.equal(calls, 2);
});

test('OpenAI and OCR diagnostics record request, response, and parsing timings without source text', () => {
  const client = readFileSync('lib/ai/openAiClient.ts', 'utf8');
  const ocr = readFileSync('lib/ocr/openAiOcr.ts', 'utf8');
  assert.match(client, /request_started/);
  assert.match(client, /response_received/);
  assert.match(client, /response_parsed/);
  assert.match(client, /elapsedMs: Date\.now\(\) - attemptStartedAt/);
  assert.match(ocr, /ocr_response_received/);
  assert.match(ocr, /textLength: text\.length/);
  assert.doesNotMatch(client, /outputText\.slice|console\.log\(outputText/);
});
