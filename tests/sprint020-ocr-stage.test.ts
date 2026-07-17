import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractDocumentText } from '../lib/documents/extractText';
import type { OcrProvider } from '../lib/ocr/ocrProvider';
import { TenancyExtractionError } from '../lib/ai/extractTenancy';
import { createTenancyUploadHandler } from '../lib/tenancy/tenancyUploadHandler';

const selectedText = 'MALAYSIAN TENANCY AGREEMENT\nTenant: Selected Text Tenant\nLandlord: Selected Text Landlord\nMonthly rental: RM 3,500.00\nSecurity deposit: RM 7,000.00\nCommencement date: 01 July 2026\nExpiry date: 30 June 2028';

test('a PDF with selectable text bypasses OCR completely', async () => {
  const pdf = await makePdf({ selectedPages: [selectedText] });
  let calls = 0;
  const provider: OcrProvider = {
    providerName: 'test-ocr',
    async extractText() {
      calls += 1;
      return { status: 'completed', text: 'OCR should not have been called', error: '' };
    }
  };

  const result = await extractDocumentText({ buffer: pdf, filename: 'Core T1-08-05 TA 140526-1.pdf', mimeType: 'application/pdf' }, provider, { requestId: 'ocr-selectable-pdf' });
  assert.equal(result.status, 'completed');
  assert.equal(result.usedOcr, false);
  assert.equal(result.pageCount, 1);
  assert.equal(calls, 0);
  assert.match(result.text, /Selected Text Tenant/);
});

test('only image-only PDF pages are sent to the OCR provider and failures keep the OCR stage code', async () => {
  const pdf = await makePdf({ selectedPages: [selectedText], imageOnlyPages: 1 });
  const calls: Array<{ filename: string; pageNumber?: number }> = [];
  const provider: OcrProvider = {
    providerName: 'test-ocr',
    async extractText(input, context) {
      calls.push({ filename: input.filename, pageNumber: context?.pageNumber });
      return { status: 'completed', text: 'SCANNED PAGE CONTENT', error: '' };
    }
  };

  const result = await extractDocumentText({ buffer: pdf, filename: 'mixed-tenancy.pdf', mimeType: 'application/pdf' }, provider, { requestId: 'ocr-mixed-pdf' });
  assert.equal(result.status, 'completed');
  assert.equal(result.usedOcr, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { filename: 'mixed-tenancy-page-2.pdf', pageNumber: 2 });
  assert.match(result.text, /Selected Text Tenant/);
  assert.match(result.text, /SCANNED PAGE CONTENT/);

  const failed = await extractDocumentText({ buffer: pdf, filename: 'mixed-tenancy.pdf', mimeType: 'application/pdf' }, {
    providerName: 'test-ocr',
    async extractText() {
      return { status: 'failed', text: '', error: 'ocr-provider-request-failed' };
    }
  }, { requestId: 'ocr-failure-pdf' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'ocr_provider_request_failed');
  assert.equal(failed.pageCount, 2);
  assert.equal(failed.usedOcr, true);
});

test('an OCR-stage failure is returned through the upload route as JSON with a precise code and message', async () => {
  const query = { eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
  const handler = createTenancyUploadHandler({
    extractTenancyFile: async () => { throw new TenancyExtractionError('ocr_provider_timeout'); },
    requireWorkspaceAccess: async () => ({
      supabase: {
        from: () => ({ select: () => query }),
        storage: { from: () => ({ upload: async () => ({ data: { path: 'stored-path' }, error: null }), remove: async () => ({ error: null }) }) },
        rpc: async () => ({ data: { document: { id: 'document-1' }, extraction: { id: 'extraction-1' } }, error: null })
      },
      user: { id: 'user-1' }, workspaceId: 'workspace-test', role: 'owner'
    }) as never,
    workspaceStoragePath: () => 'workspace-test/tenancy-agreements/scanned.pdf'
  });
  const body = new FormData();
  body.append('file', new File(['%PDF-1.7\nsynthetic'], 'scanned.pdf', { type: 'application/pdf' }));
  const response = await handler(new Request('https://nexora.test/api/tenancy-import/upload', { method: 'POST', body }));
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 422);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual({ success: payload.success, stage: payload.stage, code: payload.code, message: payload.message }, {
    success: false,
    stage: 'ocr',
    code: 'ocr_provider_timeout',
    message: 'The OCR provider timed out while reading a scanned page.'
  });
});

async function makePdf(options: { selectedPages?: string[]; imageOnlyPages?: number }): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of options.selectedPages ?? []) {
    const page = document.addPage([612, 792]);
    page.drawText(text, { x: 50, y: 700, size: 11, font, lineHeight: 15, maxWidth: 500 });
  }
  const image = await document.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'));
  for (let index = 0; index < (options.imageOnlyPages ?? 0); index += 1) {
    const page = document.addPage([612, 792]);
    page.drawImage(image, { x: 50, y: 50, width: 512, height: 662 });
  }
  return Buffer.from(await document.save({ useObjectStreams: false }));
}
