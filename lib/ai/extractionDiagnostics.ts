type DiagnosticDetails = {
  requestId?: string;
  stage?: 'auth' | 'upload' | 'validation' | 'storage' | 'pdf' | 'docx' | 'ocr' | 'openai' | 'parser' | 'mapping' | 'database' | 'unknown';
  authenticated?: boolean;
  fileType?: string;
  fileSize?: number;
  textLength?: number;
  usedOcr?: boolean;
  openAiConfigured?: boolean;
  openAiKeyPresent?: boolean;
  configurationReason?: string;
  tenancyModel?: string;
  ocrModel?: string;
  attempt?: number;
  statusCode?: number;
  elapsedMs?: number;
  errorName?: string;
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedRequestCostUsd?: number;
  provider?: 'openai' | 'deterministic';
  fallbackReason?: string | null;
  persisted?: boolean;
};

export function logExtractionDiagnostic(event: string, details: DiagnosticDetails = {}): void {
  if (typeof window !== 'undefined') return;
  const payload = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
  console.info('[tenancy-extraction]', event, payload);
}

export function logExtractionFailure(event: string, reason: string): void {
  if (typeof window !== 'undefined') return;
  console.warn('[tenancy-extraction]', event, { reason });
}

export function logOpenAiDiagnostic(event: string, details: DiagnosticDetails = {}): void {
  logExtractionDiagnostic(`openai_${event}`, details);
}

export function logOpenAiError(
  event: string,
  error: unknown,
  details: DiagnosticDetails = {}
): void {
  if (typeof window !== 'undefined') return;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown-openai-error';
  console.error('[tenancy-extraction]', `openai_${event}`, {
    ...Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)),
    errorName: error instanceof Error ? error.name : undefined,
    errorMessage: message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500)
  });
}
