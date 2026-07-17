type DiagnosticDetails = {
  fileType?: string;
  textLength?: number;
  usedOcr?: boolean;
  openAiConfigured?: boolean;
  openAiKeyPresent?: boolean;
  configurationReason?: string;
  tenancyModel?: string;
  ocrModel?: string;
  attempt?: number;
  statusCode?: number;
  requestId?: string;
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
