export type OcrResult = {
  status: 'completed' | 'not_configured' | 'failed';
  text: string;
  error: string;
};

export type OcrRequestContext = {
  requestId?: string;
  pageNumber?: number;
  pageCount?: number;
};

export interface OcrProvider {
  readonly providerName?: string;
  extractText(input: { buffer: Buffer; mimeType: string; filename: string }, context?: OcrRequestContext): Promise<OcrResult>;
}
