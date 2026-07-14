import type { MatchResult } from './types';

export async function explainCommercialMatch(result: MatchResult) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: 'not_configured' as const, text: result.explanation, model: '', generatedAt: null };
  const model = process.env.OPENAI_COMMERCIAL_MODEL || process.env.OPENAI_OCR_MODEL || 'gpt-4.1-mini';
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: [{ role: 'user', content: [{ type: 'input_text', text: `Explain this deterministic commercial-property match for an internal agent. Do not change the score or invent facts. Mark missing information. Data: ${JSON.stringify(result)}` }] }] }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) return { status: 'failed' as const, text: result.explanation, model, generatedAt: null };
    const payload = await response.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = (payload.output ?? []).flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('\n').trim();
    return text ? { status: 'completed' as const, text, model, generatedAt: new Date().toISOString() } : { status: 'failed' as const, text: result.explanation, model, generatedAt: null };
  } catch {
    return { status: 'failed' as const, text: result.explanation, model, generatedAt: null };
  }
}
