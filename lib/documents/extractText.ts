import { createOcrProvider } from '../ocr/openAiOcr';
import type { OcrProvider } from '../ocr/ocrProvider';
import { maxDocumentPageCount } from './types';
import { detectScannedDocument } from './detectScannedDocument';
import { parseDocx } from './parseDocx';
import { parsePdfDocument } from './parsePdf';
import { logExtractionDiagnostic, logExtractionFailure } from '../ai/extractionDiagnostics';

export type ExtractionFailureStage = 'pdf' | 'ocr' | 'parser';

export type DocumentTextResult = {
  status: 'completed' | 'failed' | 'not_configured';
  text: string;
  error: string;
  pageCount: number | null;
  usedOcr: boolean;
  failureStage?: ExtractionFailureStage;
  errorDetail?: string;
};

export async function extractDocumentText(
  input: { buffer: Buffer; mimeType: string; filename: string },
  ocrProvider: OcrProvider = createOcrProvider()
): Promise<DocumentTextResult> {
  let failureStage: ExtractionFailureStage = input.mimeType === 'application/pdf' ? 'pdf' : 'parser';
  logExtractionDiagnostic('file_received', {
    stage: failureStage,
    filename: input.filename,
    fileType: input.mimeType,
    fileSize: input.buffer.length
  });

  try {
    if (input.mimeType === 'application/pdf') {
      const parsed = await parsePdfDocument(input.buffer);
      logExtractionDiagnostic('pdf_text_extracted', {
        stage: 'pdf',
        filename: input.filename,
        fileType: 'pdf',
        pageCount: parsed.pageCount,
        textLength: parsed.text.length,
        usedOcr: false
      });
      if (parsed.pageCount > maxDocumentPageCount) {
        return {
          status: 'failed', text: '', error: 'page-limit-exceeded',
          errorDetail: `PDF has ${parsed.pageCount} pages; the maximum supported page count is ${maxDocumentPageCount}.`,
          failureStage: 'pdf', pageCount: parsed.pageCount, usedOcr: false
        };
      }
      const scannedPageDetected = parsed.pageTexts.some((pageText) => detectScannedDocument(pageText, input.mimeType).ocrRequired);
      if (!scannedPageDetected && !detectScannedDocument(parsed.text, input.mimeType).ocrRequired) {
        logExtractionDiagnostic('ocr_not_required', { stage: 'ocr', filename: input.filename, fileType: 'pdf', textLength: parsed.text.length });
        return { status: 'completed', text: parsed.text, error: '', pageCount: parsed.pageCount, usedOcr: false };
      }
      failureStage = 'ocr';
      logExtractionDiagnostic('ocr_started', { stage: 'ocr', filename: input.filename, fileType: 'pdf', pageCount: parsed.pageCount });
    }
    if (input.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const text = await parseDocx(input.buffer);
      logExtractionDiagnostic('document_text_extracted', { stage: 'parser', filename: input.filename, fileType: 'docx', textLength: text.length, usedOcr: false });
      return text.trim()
        ? { status: 'completed', text, error: '', pageCount: null, usedOcr: false }
        : {
          status: 'failed', text: '', error: 'empty-extraction',
          errorDetail: 'The DOCX file did not contain readable text.', failureStage: 'parser', pageCount: null, usedOcr: false
        };
    }
    if (input.mimeType === 'text/plain') {
      const text = input.buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
      logExtractionDiagnostic('document_text_extracted', { stage: 'parser', filename: input.filename, fileType: 'txt', textLength: text.length, usedOcr: false });
      return text
        ? { status: 'completed', text, error: '', pageCount: null, usedOcr: false }
        : {
          status: 'failed', text: '', error: 'empty-extraction',
          errorDetail: 'The text file was empty.', failureStage: 'parser', pageCount: null, usedOcr: false
        };
    }
    failureStage = 'ocr';
    logExtractionDiagnostic('ocr_started', { stage: 'ocr', filename: input.filename, fileType: input.mimeType });
    const ocr = await ocrProvider.extractText(input);
    logExtractionDiagnostic('ocr_text_extracted', {
      stage: 'ocr', filename: input.filename, fileType: input.mimeType, textLength: ocr.text.length,
      usedOcr: true, errorMessage: ocr.error || undefined
    });
    return {
      status: ocr.status, text: ocr.text, error: ocr.error, pageCount: null, usedOcr: true,
      failureStage: ocr.status === 'completed' ? undefined : 'ocr',
      errorDetail: ocr.status === 'completed' ? undefined : `OCR failed: ${ocr.error || 'no readable text was returned.'}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'document-processing-failed';
    const protectedPdf = /password|encrypted|encryption/i.test(message);
    logExtractionFailure(`${failureStage}_failed`, message);
    logExtractionDiagnostic('document_text_failed', {
      stage: failureStage,
      filename: input.filename,
      fileType: input.mimeType,
      usedOcr: failureStage === 'ocr',
      errorMessage: message.slice(0, 500)
    });
    return {
      status: 'failed', text: '', error: protectedPdf ? 'password-protected-pdf' : 'unreadable-document',
      errorDetail: protectedPdf ? 'The PDF is password protected or encrypted.' : message,
      failureStage, pageCount: null, usedOcr: failureStage === 'ocr'
    };
  }
}
