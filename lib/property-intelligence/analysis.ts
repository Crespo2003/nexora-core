import type { PropertyIntelligenceResult } from './types';

export type BilingualPropertyNarrative = {
  summaryEn: string;
  summaryZh: string;
  marketingDescriptionEn: string;
  marketingDescriptionZh: string;
  strengthsEn: string[];
  strengthsZh: string[];
  weaknessesEn: string[];
  weaknessesZh: string[];
  suitableTenantProfileEn: string;
  suitableTenantProfileZh: string;
  suitableBuyerProfileEn: string;
  suitableBuyerProfileZh: string;
  commercialSuitabilityEn: string;
  commercialSuitabilityZh: string;
  investmentOpinionEn: string;
  investmentOpinionZh: string;
  aiModel: string;
  aiStatus: 'generated' | 'not_configured' | 'failed';
};

export async function createPropertyNarrative(property: Record<string, unknown>, result: PropertyIntelligenceResult): Promise<BilingualPropertyNarrative> {
  const fallback = deterministicNarrative(property, result);
  if (!process.env.OPENAI_API_KEY) return fallback;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_PROPERTY_MODEL || 'gpt-4.1-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a Malaysian property analyst. Return concise JSON only. Never invent facts. Explicitly state when evidence is missing. Provide every requested field in English and Simplified Chinese.' },
          { role: 'user', content: JSON.stringify({ property, calculatedEvidence: result, fields: Object.keys(fallback).filter((key) => !['aiModel','aiStatus'].includes(key)) }) }
        ]
      })
    });
    if (!response.ok) return { ...fallback, aiStatus: 'failed' };
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? '{}') as Partial<BilingualPropertyNarrative>;
    return { ...fallback, ...sanitizeNarrative(parsed, fallback), aiModel: process.env.OPENAI_PROPERTY_MODEL || 'gpt-4.1-mini', aiStatus: 'generated' };
  } catch {
    return { ...fallback, aiStatus: 'failed' };
  }
}

function deterministicNarrative(property: Record<string, unknown>, result: PropertyIntelligenceResult): BilingualPropertyNarrative {
  const name = String(property.property_name || property.property || property.title || 'Property');
  const address = String(property.address || property.property_address || 'location not supplied');
  const score = result.score.overall;
  const evidence = result.warnings.length ? result.warnings.join(' ') : 'Comparable and nearby-place evidence is available.';
  return {
    summaryEn: `${name} at ${address} has an evidence-based investment score of ${score}/100. ${evidence}`,
    summaryZh: `${name}，地点：${address}。基于现有资料的投资评分为 ${score}/100。资料不足之处已在系统警示中列明。`,
    marketingDescriptionEn: `${name} is presented using verified property, comparable and nearby-place information recorded in Nexora.`,
    marketingDescriptionZh: `${name} 的介绍仅采用 Nexora 内已记录并可追溯的物业、可比案例及周边设施资料。`,
    strengthsEn: result.score.overall >= 70 ? ['Strong combined evidence score.'] : ['Analysis is transparent and evidence-linked.'],
    strengthsZh: result.score.overall >= 70 ? ['综合资料评分较高。'] : ['分析透明，并与资料来源关联。'],
    weaknessesEn: result.warnings.length ? result.warnings : ['No material evidence gaps identified.'],
    weaknessesZh: result.warnings.length ? ['部分估值资料尚未完整，请查看系统警示。'] : ['现有资料未显示重大缺口。'],
    suitableTenantProfileEn: 'Tenant suitability requires review against the property type, location and verified rental evidence.',
    suitableTenantProfileZh: '合适租户应根据物业类型、地点及已验证的租金资料进一步评估。',
    suitableBuyerProfileEn: 'Suitable for buyers whose risk tolerance matches the displayed evidence completeness and cashflow.',
    suitableBuyerProfileZh: '适合买方应根据所显示的资料完整度及现金流，评估自身风险承受能力。',
    commercialSuitabilityEn: `Commercial potential score: ${result.score.commercialPotential}/100. This is an analytical indicator, not zoning advice.`,
    commercialSuitabilityZh: `商业潜力评分：${result.score.commercialPotential}/100。此评分仅供分析，不构成土地用途或规划意见。`,
    investmentOpinionEn: `The current evidence supports a ${score >= 70 ? 'positive' : score >= 50 ? 'balanced' : 'cautious'} review. Verify valuation, title, financing and transaction data before a decision.`,
    investmentOpinionZh: `现有资料支持${score >= 70 ? '正面' : score >= 50 ? '平衡' : '审慎'}评估。作出决定前，应核实估值、产权、融资及交易资料。`,
    aiModel: '',
    aiStatus: 'not_configured'
  };
}

function sanitizeNarrative(value: Partial<BilingualPropertyNarrative>, fallback: BilingualPropertyNarrative) {
  const output: Partial<BilingualPropertyNarrative> = {};
  for (const key of Object.keys(fallback) as Array<keyof BilingualPropertyNarrative>) {
    if (key === 'aiModel' || key === 'aiStatus') continue;
    const candidate = value[key];
    if (Array.isArray(fallback[key])) {
      (output as Record<string, unknown>)[key] = Array.isArray(candidate) ? candidate.map(String).slice(0, 8) : fallback[key];
    } else {
      (output as Record<string, unknown>)[key] = typeof candidate === 'string' && candidate.trim() ? candidate.slice(0, 4000) : fallback[key];
    }
  }
  return output;
}
