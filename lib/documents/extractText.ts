import { logExtractionDiagnostic } from '../ai/extractionDiagnostics';
import { createOcrProvider } from '../ocr/openAiOcr';
import type { OcrProvider } from '../ocr/ocrProvider';
import { maxDocumentPageCount } from './types';
import { parseDocx } from './parseDocx';
import { parsePdfDocument, type ParsedPdfPage } from './parsePdf';
import { splitPdfPagesForOcr } from './splitPdfPages';

export type DocumentTextResult = {
  status: 'completed' | 'failed' | 'not_configured';
  text: string;
  error: string;
  pageCount: number | null;
  usedOcr: boolean;
};

export type OcrStageResponse =
  | { success: true; text: string; pageCount: number }
  | { success: false; stage: 'ocr'; code: string; message: string };

type ExtractionContext = {
  requestId?: string;
};

type PdfPageState = ParsedPdfPage & {
  pageNumber: number;
  requiresOcr: boolean;
};

const ocrMessages: Record<string, string> = {
  ocr_not_configured: 'OCR is not configured for scanned document pages.',
  ocr_provider_timeout: 'The OCR provider timed out while reading a scanned page.',
  ocr_provider_request_failed: 'The OCR provider could not read a scanned page.',
  ocr_malformed_or_empty_response: 'The OCR provider returned no readable text for a scanned page.',
  ocr_page_preparation_failed: 'A scanned PDF page could not be prepared for OCR.',
  ocr_page_out_of_range: 'A scanned PDF page could not be prepared for OCR.',
  ocr_processing_failed: 'The OCR stage could not complete.'
};

export async function extractDocumentText(
  input: { buffer: Buffer; mimeType: string; filename: string },
  ocrProvider: OcrProvider = createOcrProvider(),
  context: ExtractionContext = {}
): Promise<DocumentTextResult> {
  try {
    if (input.mimeType === 'application/pdf') {
      const startedAt = Date.now();
      logExtractionDiagnostic('pdf_text_extraction_started', {
        requestId: context.requestId,
        stage: 'pdf',
        fileType: 'pdf',
        fileSize: input.buffer.byteLength
      });
      const parsed = await parsePdfDocument(input.buffer);
      logExtractionDiagnostic('pdf_page_count_detected', {
        requestId: context.requestId,
        stage: 'pdf',
        pageCount: parsed.pageCount,
        elapsedMs: Date.now() - startedAt
      });
      if (parsed.pageCount > maxDocumentPageCount) {
        return { status: 'failed', text: '', error: 'page-limit-exceeded', pageCount: parsed.pageCount, usedOcr: false };
      }

      const pages = toPdfPageStates(parsed.pages, parsed.pageTexts, parsed.pageCount);
      for (const page of pages) {
        logExtractionDiagnostic('pdf_page_text_extracted', {
          requestId: context.requestId,
          stage: 'pdf',
          pageNumber: page.pageNumber,
          pageCount: parsed.pageCount,
          textLength: page.text.length,
          hasImages: page.hasImages,
          usedOcr: page.requiresOcr
        });
      }

      const scannedPages = pages.filter((page) => page.requiresOcr);
      if (scannedPages.length === 0) {
        const text = joinPageText(pages, parsed.text);
        logExtractionDiagnostic('pdf_text_extraction_completed', {
          requestId: context.requestId,
          stage: 'pdf',
          pageCount: parsed.pageCount,
          textLength: text.length,
          usedOcr: false,
          elapsedMs: Date.now() - startedAt
        });
        return text.trim()
          ? { status: 'completed', text, error: '', pageCount: parsed.pageCount, usedOcr: false }
          : { status: 'failed', text: '', error: 'empty-extraction', pageCount: parsed.pageCount, usedOcr: false };
      }

      const ocr = await extractScannedPdfPages(input, pages, scannedPages, ocrProvider, context);
      if (ocr.success === false) {
        return {
          status: ocr.code === 'ocr_not_configured' ? 'not_configured' : 'failed',
          text: '',
          error: ocr.code,
          pageCount: parsed.pageCount,
          usedOcr: true
        };
      }
      logExtractionDiagnostic('pdf_text_extraction_completed', {
        requestId: context.requestId,
        stage: 'ocr',
        pageCount: parsed.pageCount,
        scannedPageCount: scannedPages.length,
        textLength: ocr.text.length,
        usedOcr: true,
        elapsedMs: Date.now() - startedAt
      });
      return { status: 'completed', text: ocr.text, error: '', pageCount: ocr.pageCount, usedOcr: true };
    }
    if (input.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const text = await parseDocx(input.buffer);
      return text.trim()
        ? { status: 'completed', text, error: '', pageCount: null, usedOcr: false }
        : { status: 'failed', text: '', error: 'empty-extraction', pageCount: null, usedOcr: false };
    }
    if (input.mimeType === 'text/plain') {
      const text = input.buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
      return text
        ? { status: 'completed', text, error: '', pageCount: null, usedOcr: false }
        : { status: 'failed', text: '', error: 'empty-extraction', pageCount: null, usedOcr: false };
    }
    const ocr = await ocrProvider.extractText(input, { requestId: context.requestId });
    return { status: ocr.status, text: ocr.text, error: ocr.error, pageCount: null, usedOcr: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'document-processing-failed';
    const protectedPdf = /password|encrypted|encryption/i.test(message);
    logExtractionDiagnostic('document_text_extraction_failed', {
      requestId: context.requestId,
      stage: input.mimeType === 'application/pdf' ? 'pdf' : 'parser',
      errorName: error instanceof Error ? error.name : 'unknown',
      errorCode: protectedPdf ? 'password-protected-pdf' : 'unreadable-document'
    });
    return { status: 'failed', text: '', error: protectedPdf ? 'password-protected-pdf' : 'unreadable-document', pageCount: null, usedOcr: false };
  }
}

export async function extractScannedPdfPages(
  input: { buffer: Buffer; mimeType: string; filename: string },
  pages: PdfPageState[],
  scannedPages: PdfPageState[],
  ocrProvider: OcrProvider,
  context: ExtractionContext = {}
): Promise<OcrStageResponse> {
  try {
    const provider = ocrProvider.providerName ?? 'custom';
    logExtractionDiagnostic('ocr_provider_selected', {
      requestId: context.requestId,
      stage: 'ocr',
      ocrProvider: provider,
      pageCount: pages.length,
      scannedPageCount: scannedPages.length
    });
    const split = await splitPdfPagesForOcr(input, scannedPages.map((page) => page.pageNumber));
    if (split.success === false) {
      logExtractionDiagnostic('ocr_page_preparation_failed', {
        requestId: context.requestId,
        stage: 'ocr',
        ocrProvider: provider,
        ocrCode: split.code
      });
      return split;
    }

    const ocrText = new Map<number, string>();
    for (const pageInput of split.pages) {
      logExtractionDiagnostic('ocr_page_request_started', {
        requestId: context.requestId,
        stage: 'ocr',
        ocrProvider: provider,
        pageNumber: pageInput.pageNumber,
        pageCount: pages.length,
        payloadType: pageInput.mimeType,
        payloadBytes: pageInput.buffer.byteLength
      });
      const response = await ocrProvider.extractText(pageInput, {
        requestId: context.requestId,
        pageNumber: pageInput.pageNumber,
        pageCount: pages.length
      });
      logExtractionDiagnostic('ocr_page_response_received', {
        requestId: context.requestId,
        stage: 'ocr',
        ocrProvider: provider,
        pageNumber: pageInput.pageNumber,
        pageCount: pages.length,
        ocrStatus: response.status,
        ocrCode: response.error || undefined,
        textLength: response.text.length
      });
      if (response.status !== 'completed' || !response.text.trim()) {
        const code = normalizeOcrCode(response);
        const message = ocrMessages[code] ?? 'The OCR provider could not read a scanned page.';
        logExtractionDiagnostic('ocr_page_failed', {
          requestId: context.requestId,
          stage: 'ocr',
          ocrProvider: provider,
          pageNumber: pageInput.pageNumber,
          pageCount: pages.length,
          ocrCode: code
        });
        return { success: false, stage: 'ocr', code, message };
      }
      ocrText.set(pageInput.pageNumber, response.text.trim());
    }

    return {
      success: true,
      text: pages.map((page) => `--- PAGE ${page.pageNumber} ---\n${ocrText.get(page.pageNumber) ?? page.text}`).join('\n\n').trim(),
      pageCount: pages.length
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : ocrMessages.ocr_processing_failed;
    logExtractionDiagnostic('ocr_stage_failed', {
      requestId: context.requestId,
      stage: 'ocr',
      errorName: error instanceof Error ? error.name : 'unknown',
      ocrCode: 'ocr_processing_failed'
    });
    return { success: false, stage: 'ocr', code: 'ocr_processing_failed', message };
  }
}

function toPdfPageStates(pages: ParsedPdfPage[], pageTexts: string[], pageCount: number): PdfPageState[] {
  return Array.from({ length: pageCount }, (_, index) => {
    const page = pages[index] ?? { text: pageTexts[index] ?? '', hasImages: false };
    return {
      ...page,
      pageNumber: index + 1,
      requiresOcr: page.hasImages && page.text.trim().length < 80
    };
  });
}

function joinPageText(pages: PdfPageState[], parsedText: string): string {
  const text = pages.map((page) => `--- PAGE ${page.pageNumber} ---\n${page.text}`).join('\n\n').trim();
  return text || parsedText.trim();
}

function normalizeOcrCode(result: { status: string; error: string }): string {
  if (result.status === 'not_configured') return 'ocr_not_configured';
  const normalized = result.error.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return normalized || 'ocr_processing_failed';
}
