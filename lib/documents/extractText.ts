import { createOcrProvider } from '../ocr/openAiOcr';
import type { OcrProvider } from '../ocr/ocrProvider';
import { maxDocumentPageCount } from './types';
import { parseDocx } from './parseDocx';
import { parsePdfDocument } from './parsePdf';

export type DocumentTextResult = {
  status: 'completed' | 'failed' | 'not_configured';
  text: string;
  error: string;
  pageCount: number | null;
  usedOcr: boolean;
};

export async function extractDocumentText(
  input: { buffer: Buffer; mimeType: string; filename: string },
  ocrProvider: OcrProvider = createOcrProvider()
): Promise<DocumentTextResult> {
  try {
    if (input.mimeType === 'application/pdf') {
      const parsed = await parsePdfDocument(input.buffer);
      if (parsed.pageCount > maxDocumentPageCount) {
        return { status: 'failed', text: '', error: 'page-limit-exceeded', pageCount: parsed.pageCount, usedOcr: false };
      }
      if (parsed.text.trim()) return { status: 'completed', text: parsed.text, error: '', pageCount: parsed.pageCount, usedOcr: false };
    }
    if (input.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const text = await parseDocx(input.buffer);
      return text.trim()
        ? { status: 'completed', text, error: '', pageCount: null, usedOcr: false }
        : { status: 'failed', text: '', error: 'empty-extraction', pageCount: null, usedOcr: false };
    }
    const ocr = await ocrProvider.extractText(input);
    return { status: ocr.status, text: ocr.text, error: ocr.error, pageCount: null, usedOcr: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'document-processing-failed';
    const protectedPdf = /password|encrypted|encryption/i.test(message);
    return { status: 'failed', text: '', error: protectedPdf ? 'password-protected-pdf' : 'unreadable-document', pageCount: null, usedOcr: false };
  }
}
