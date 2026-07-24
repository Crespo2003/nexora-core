import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createTenancyUploadHandler } from '../lib/tenancy/tenancyUploadHandler';
import { maxTenancyUploadBytes } from '../lib/tenancy/uploadLimits';

const workspaceId = 'workspace-streaming-test';
const agreementText = 'MALAYSIAN TENANCY AGREEMENT\nTenant: Streaming Tenant\nLandlord: Streaming Landlord\nMonthly rental: RM 3500\nSecurity deposit: RM 7000\nCommencement date: 2026-07-01\nExpiry date: 2028-06-30';

test('the browser and server share a 50 MB tenancy limit and use direct signed Storage uploads', () => {
  const ui = readFileSync('app/rental-command-centre.tsx', 'utf8');
  const handler = readFileSync('lib/tenancy/tenancyUploadHandler.ts', 'utf8');
  assert.equal(maxTenancyUploadBytes, 50 * 1024 * 1024);
  assert.match(ui, /maxTenancyUploadBytes/);
  assert.match(ui, /uploadToSignedStorage/);
  assert.match(ui, /xhr\.upload\.onprogress/);
  assert.match(handler, /createSignedUploadUrl/);
  assert.match(handler, /\.download\(storagePath\)/);
  assert.match(handler, /maxUploadBytes: maxTenancyUploadBytes/);
});

test('prepare returns a signed browser upload target without receiving the tenancy file', async () => {
  const calls = { signedUrls: 0, downloads: 0, serverUploads: 0 };
  const handler = streamingHandler(calls);
  const response = await handler(jsonRequest({
    action: 'prepare',
    filename: 'streaming-agreement.txt',
    mimeType: 'text/plain',
    fileSize: agreementText.length
  }));

  assert.equal(response.status, 200);
  const payload = await response.json() as Record<string, any>;
  assert.equal(payload.success, true);
  assert.equal(payload.maxUploadBytes, maxTenancyUploadBytes);
  assert.match(payload.upload.signedUrl, /object\/upload\/sign/);
  assert.match(payload.upload.storagePath, new RegExp(`^${workspaceId}/tenancy-agreements/`));
  assert.deepEqual(calls, { signedUrls: 1, downloads: 0, serverUploads: 0 });
});

test('finalize validates the directly uploaded file and never re-uploads it through the server', async () => {
  const calls = { signedUrls: 0, downloads: 0, serverUploads: 0 };
  const handler = streamingHandler(calls);
  const storagePath = `${workspaceId}/tenancy-agreements/2026/07/streaming-agreement.txt`;
  const response = await handler(jsonRequest({
    action: 'finalize',
    filename: 'streaming-agreement.txt',
    mimeType: 'text/plain',
    fileSize: agreementText.length,
    storagePath
  }));

  assert.equal(response.status, 200);
  const payload = await response.json() as Record<string, any>;
  assert.equal(payload.success, true);
  assert.equal(payload.document.storagePath, storagePath);
  assert.equal(payload.document.fileSize, agreementText.length);
  assert.equal(payload.document.documentHash.length, 64);
  assert.deepEqual(calls, { signedUrls: 0, downloads: 1, serverUploads: 0 });
});

test('prepare returns a clear JSON limit error above 50 MB', async () => {
  const calls = { signedUrls: 0, downloads: 0, serverUploads: 0 };
  const handler = streamingHandler(calls);
  const response = await handler(jsonRequest({
    action: 'prepare',
    filename: 'large-agreement.pdf',
    mimeType: 'application/pdf',
    fileSize: maxTenancyUploadBytes + 1
  }));

  assert.equal(response.status, 413);
  const payload = await response.json() as Record<string, unknown>;
  assert.deepEqual({ success: payload.success, stage: payload.stage, code: payload.code, maxUploadBytes: payload.maxUploadBytes }, {
    success: false,
    stage: 'validation',
    code: 'file-too-large',
    maxUploadBytes: maxTenancyUploadBytes
  });
  assert.match(String(payload.error), /50 MB/);
  assert.deepEqual(calls, { signedUrls: 0, downloads: 0, serverUploads: 0 });
});

function streamingHandler(calls: { signedUrls: number; downloads: number; serverUploads: number }) {
  const query = { eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
  const supabase = {
    from: () => ({ select: () => query }),
    storage: {
      from: () => ({
        createSignedUploadUrl: async (storagePath: string) => {
          calls.signedUrls += 1;
          return { data: { signedUrl: `https://storage.test/object/upload/sign/real-estate-documents/${storagePath}?token=test`, path: storagePath, token: 'test' }, error: null };
        },
        info: async () => ({ data: { size: agreementText.length }, error: null }),
        download: async () => {
          calls.downloads += 1;
          return { data: new Blob([agreementText], { type: 'text/plain' }), error: null };
        },
        upload: async () => {
          calls.serverUploads += 1;
          return { data: { path: 'unexpected-server-upload' }, error: null };
        },
        remove: async () => ({ error: null })
      })
    },
    rpc: async () => ({ data: { document: { id: 'document-1' }, extraction: { id: 'extraction-1' } }, error: null })
  };

  return createTenancyUploadHandler({
    extractTenancyFile: async () => extractionFixture() as never,
    requireWorkspaceAccess: async () => ({ supabase, user: { id: 'user-streaming' }, workspaceId, role: 'owner' }) as never,
    workspaceStoragePath: (_workspaceId, documentType, filename) => `${workspaceId}/${documentType}/2026/07/${filename}`,
    getOpenAiConfiguration: () => ({ configured: true, apiKey: 'test-key', tenancyModel: 'gpt-5.5' }) as never
  });
}

function jsonRequest(payload: Record<string, unknown>) {
  return new Request('https://nexora.test/api/tenancy-import/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function extractionFixture() {
  return {
    rawText: agreementText,
    summary: 'Streaming tenancy extraction.',
    provider: 'openai' as const,
    fallbackUsed: false,
    fallbackReason: null,
    document: {
      originalFilename: 'streaming-agreement.txt',
      documentType: 'tenancy_agreement',
      usedOcr: false,
      pageCount: null,
      model: 'gpt-5.5',
      chunkCount: 1
    },
    legalIntelligence: {
      confidence: 0.95,
      risks: [],
      warnings: []
    }
  };
}
