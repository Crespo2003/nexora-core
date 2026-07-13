export async function parsePdf(buffer: Buffer): Promise<string> {
  const parserModule = await import('pdf-parse/lib/pdf-parse.js');
  const pdfParse = (parserModule.default ?? parserModule) as (input: Buffer) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  return result.text.trim();
}
