export async function parsePdf(buffer: Buffer): Promise<string> {
  return (await parsePdfDocument(buffer)).text;
}

export async function parsePdfDocument(buffer: Buffer): Promise<{ text: string; pageCount: number; pageTexts: string[] }> {
  const parserModule = await import('pdf-parse/lib/pdf-parse.js');
  type PdfTextItem = { str?: string; hasEOL?: boolean };
  type PdfPage = { getTextContent(): Promise<{ items: PdfTextItem[] }> };
  const pdfParse = (parserModule.default ?? parserModule) as (
    input: Buffer,
    options?: { pagerender?: (page: PdfPage) => Promise<string> }
  ) => Promise<{ text: string; numpages?: number }>;
  const pageTexts: string[] = [];
  const result = await pdfParse(buffer, {
    pagerender: async (page) => {
      const content = await page.getTextContent();
      const text = content.items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`).join('').trim();
      pageTexts.push(text);
      return text;
    }
  });
  return { text: result.text.trim(), pageCount: Number(result.numpages ?? pageTexts.length), pageTexts };
}
