export const CRM_PIPELINE_STAGES = [
  'NEW_ENQUIRY',
  'CONTACTED',
  'QUALIFIED',
  'MATCHED',
  'VIEWING_SCHEDULED',
  'VIEWING_COMPLETED',
  'FOLLOW_UP',
  'NEGOTIATION',
  'BOOKING',
  'LEGAL',
  'HANDOVER',
  'CLOSED',
  'LOST',
  'AFTER_SALES',
] as const;

export type CrmPipelineStage = typeof CRM_PIPELINE_STAGES[number];

export const CRM_PIPELINE_LABELS: Record<CrmPipelineStage, { en: string; zh: string }> = {
  NEW_ENQUIRY: { en: 'New enquiry', zh: '新询盘' },
  CONTACTED: { en: 'Contacted', zh: '已联系' },
  QUALIFIED: { en: 'Qualified', zh: '已筛选' },
  MATCHED: { en: 'Matched', zh: '已匹配' },
  VIEWING_SCHEDULED: { en: 'Viewing scheduled', zh: '已安排看房' },
  VIEWING_COMPLETED: { en: 'Viewing completed', zh: '已完成看房' },
  FOLLOW_UP: { en: 'Follow-up', zh: '跟进中' },
  NEGOTIATION: { en: 'Negotiation', zh: '洽谈中' },
  BOOKING: { en: 'Booking', zh: '预订' },
  LEGAL: { en: 'Legal', zh: '法律程序' },
  HANDOVER: { en: 'Handover', zh: '交接' },
  CLOSED: { en: 'Closed', zh: '已成交' },
  LOST: { en: 'Lost', zh: '已流失' },
  AFTER_SALES: { en: 'After-sales', zh: '售后服务' },
};

const transitions: Record<CrmPipelineStage, readonly CrmPipelineStage[]> = {
  NEW_ENQUIRY: ['CONTACTED', 'LOST'],
  CONTACTED: ['QUALIFIED', 'LOST'],
  QUALIFIED: ['MATCHED', 'VIEWING_SCHEDULED', 'LOST'],
  MATCHED: ['VIEWING_SCHEDULED', 'NEGOTIATION', 'LOST'],
  VIEWING_SCHEDULED: ['VIEWING_COMPLETED', 'LOST'],
  VIEWING_COMPLETED: ['FOLLOW_UP', 'NEGOTIATION', 'LOST'],
  FOLLOW_UP: ['MATCHED', 'VIEWING_SCHEDULED', 'NEGOTIATION', 'LOST'],
  NEGOTIATION: ['BOOKING', 'LOST'],
  BOOKING: ['LEGAL', 'HANDOVER', 'LOST'],
  LEGAL: ['HANDOVER', 'LOST'],
  HANDOVER: ['CLOSED', 'LOST'],
  CLOSED: ['AFTER_SALES'],
  LOST: [],
  AFTER_SALES: [],
};

export function isCrmPipelineStage(value: unknown): value is CrmPipelineStage {
  return typeof value === 'string' && CRM_PIPELINE_STAGES.includes(value as CrmPipelineStage);
}

export function validateCrmStageTransition(from: CrmPipelineStage, to: CrmPipelineStage) {
  return from === to || transitions[from].includes(to);
}

export function availableCrmStageTransitions(stage: CrmPipelineStage) {
  return transitions[stage];
}

export function crmStageLabel(stage: CrmPipelineStage, language: 'en' | 'zh') {
  return CRM_PIPELINE_LABELS[stage][language];
}

export function crmStageTone(stage: CrmPipelineStage) {
  if (stage === 'LOST') return 'danger';
  if (stage === 'CLOSED' || stage === 'AFTER_SALES') return 'success';
  if (['NEGOTIATION', 'BOOKING', 'LEGAL', 'HANDOVER'].includes(stage)) return 'warning';
  return 'info';
}
