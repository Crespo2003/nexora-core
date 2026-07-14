export async function parsePdf(buffer: Buffer): Promise<string> {
  return (await parsePdfDocument(buffer)).text;
}

export async function parsePdfDocument(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const parserModule = await import('pdf-parse/lib/pdf-parse.js');
  const pdfParse = (parserModule.default ?? parserModule) as (input: Buffer) => Promise<{ text: string; numpages?: number }>;
  const result = await pdfParse(buffer);
  return { text: result.text.trim(), pageCount: Number(result.numpages ?? 0) };
}
