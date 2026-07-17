const defaultTenancyModel = 'gpt-5.5';
const defaultOcrModel = 'gpt-4.1-mini';

export type OpenAiConfigurationStatus = {
  configured: boolean;
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
  environment: OpenAiEnvironment = process.env as OpenAiEnvironment
): OpenAiConfigurationStatus {
  assertServerRuntime();
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? '';
  return {
    configured: isUsableApiKey(apiKey),
    tenancyModel: safeModel(environment.OPENAI_TENANCY_MODEL, defaultTenancyModel),
    ocrModel: safeModel(environment.OPENAI_OCR_MODEL, defaultOcrModel),
    reason: isUsableApiKey(apiKey) ? 'configured' : 'openai_not_configured'
  };
}

export function getOpenAiApiKey(): string | null {
  const status = getOpenAiConfiguration();
  return status.configured ? process.env.OPENAI_API_KEY!.trim() : null;
}

function safeModel(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() ?? '';
  return /^[a-z0-9][a-z0-9._-]{1,79}$/i.test(candidate) ? candidate : fallback;
}

function isUsableApiKey(value: string): boolean {
  if (value.length < 20) return false;
  return !/^(?:replace|example|your[_-]|test|undefined|null)|[<>]/i.test(value);
}

function assertServerRuntime(): void {
  if (typeof window !== 'undefined') throw new Error('OpenAI configuration is server-only.');
}

export const openAiModelDefaults = Object.freeze({
  tenancy: defaultTenancyModel,
  ocr: defaultOcrModel
});
