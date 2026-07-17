const defaultTenancyModel = 'gpt-5.5';
const defaultOcrModel = 'gpt-4.1-mini';

export type OpenAiConfigurationStatus = {
  configured: boolean;
  keyPresent: boolean;
  tenancyModel: string;
  ocrModel: string;
  reason: 'configured' | 'openai_not_configured';
};

type OpenAiEnvironment = {
  OPENAI_API_KEY?: string;
  OPENAI_TENANCY_MODEL?: string;
  OPENAI_OCR_MODEL?: string;
};

export function getOpenAiConfiguration(
  environment: OpenAiEnvironment = readOpenAiEnvironment()
): OpenAiConfigurationStatus {
  assertServerRuntime();
  const apiKey = normalizeApiKey(environment.OPENAI_API_KEY);
  const keyPresent = Boolean(apiKey);
  return {
    configured: keyPresent,
    keyPresent,
    tenancyModel: safeModel(environment.OPENAI_TENANCY_MODEL, defaultTenancyModel),
    ocrModel: safeModel(environment.OPENAI_OCR_MODEL, defaultOcrModel),
    reason: keyPresent ? 'configured' : 'openai_not_configured'
  };
}

export function getOpenAiApiKey(): string | null {
  assertServerRuntime();
  return normalizeApiKey(process.env.OPENAI_API_KEY) || null;
}

function safeModel(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() ?? '';
  return /^[a-z0-9][a-z0-9._-]{1,79}$/i.test(candidate) ? candidate : fallback;
}

function readOpenAiEnvironment(): OpenAiEnvironment {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_TENANCY_MODEL: process.env.OPENAI_TENANCY_MODEL,
    OPENAI_OCR_MODEL: process.env.OPENAI_OCR_MODEL
  };
}

function normalizeApiKey(value: string | undefined): string {
  const candidate = value?.trim() ?? '';
  if (candidate.length >= 2) {
    const first = candidate[0];
    const last = candidate[candidate.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return candidate.slice(1, -1).trim();
    }
  }
  return candidate;
}

function assertServerRuntime(): void {
  if (typeof window !== 'undefined') throw new Error('OpenAI configuration is server-only.');
}

export const openAiModelDefaults = Object.freeze({
  tenancy: defaultTenancyModel,
  ocr: defaultOcrModel
});
