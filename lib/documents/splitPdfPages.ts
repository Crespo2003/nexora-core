export type PdfPageInput = {
  buffer: Buffer;
  filename: string;
  mimeType: 'application/pdf';
  pageNumber: number;
};

export type SplitPdfPagesResult =
  | { success: true; pages: PdfPageInput[] }
  | { success: false; stage: 'ocr'; code: string; message: string };

export async function splitPdfPagesForOcr(
  input: { buffer: Buffer; filename: string },
  pageNumbers: number[]
): Promise<SplitPdfPagesResult> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const source = await PDFDocument.load(input.buffer, { ignoreEncryption: true });
    const extensionIndex = input.filename.lastIndexOf('.');
    const baseName = extensionIndex > 0 ? input.filename.slice(0, extensionIndex) : input.filename;
    const pages: PdfPageInput[] = [];

    for (const pageNumber of pageNumbers) {
      const pageIndex = pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= source.getPageCount()) {
        return { success: false, stage: 'ocr', code: 'ocr_page_out_of_range', message: 'A scanned PDF page could not be prepared for OCR.' };
      }
      const target = await PDFDocument.create();
      const [page] = await target.copyPages(source, [pageIndex]);
      target.addPage(page);
      pages.push({
        buffer: Buffer.from(await target.save()),
        filename: `${baseName}-page-${pageNumber}.pdf`,
        mimeType: 'application/pdf',
        pageNumber
      });
    }

    return { success: true, pages };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF page preparation failed.';
    return { success: false, stage: 'ocr', code: 'ocr_page_preparation_failed', message: message.slice(0, 500) };
  }
}
