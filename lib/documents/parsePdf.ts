export async function parsePdf(buffer: Buffer): Promise<string> {
  return (await parsePdfDocument(buffer)).text;
}

export type ParsedPdfPage = {
  text: string;
  hasImages: boolean;
};

type PdfTextItem = { str?: string; hasEOL?: boolean };
type PdfPage = {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getOperatorList(): Promise<{ fnArray?: number[] }>;
};
type PdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
};
type PdfLoadingTask = {
  promise: Promise<PdfDocument>;
  destroy?: () => Promise<void> | void;
};
type PdfJsModule = {
  getDocument(options: { data: Uint8Array; disableWorker: boolean; useWorkerFetch: boolean; isEvalSupported: boolean }): PdfLoadingTask;
};

const imageOperationCodes = new Set([82, 83, 84, 85, 86, 87, 88, 89, 90]);

export async function parsePdfDocument(buffer: Buffer): Promise<{ text: string; pageCount: number; pageTexts: string[]; pages: ParsedPdfPage[] }> {
  const pdfjs = await import('pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js') as unknown as PdfJsModule;
  const loadingTask = pdfjs.getDocument({
    data: Uint8Array.from(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false
  });
  try {
    const document = await loadingTask.promise;
    const pages: ParsedPdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const [content, operatorList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      const text = content.items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`).join('').trim();
      const hasImages = operatorList.fnArray?.some((operation) => imageOperationCodes.has(operation)) ?? false;
      pages.push({ text, hasImages });
    }
    const pageTexts = pages.map((page) => page.text);
    const text = pageTexts.map((pageText, index) => `--- PAGE ${index + 1} ---\n${pageText}`).join('\n\n').trim();
    return { text, pageCount: document.numPages, pageTexts, pages };
  } finally {
    await loadingTask.destroy?.();
  }
}
