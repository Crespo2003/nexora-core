export type OcrResult = {
  status: 'completed' | 'not_configured' | 'failed';
  text: string;
  error: string;
};

export interface OcrProvider {
  extractText(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<OcrResult>;
}
