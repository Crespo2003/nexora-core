export const commercialDealStages = ['enquiry','qualification','sourcing','proposal','viewing','shortlisted','negotiation','loi','due_diligence','tenancy_agreement','spa','deposit_paid','handover','completed','lost','cancelled'] as const;
export type CommercialDealStage = typeof commercialDealStages[number];

const transitions: Record<CommercialDealStage, CommercialDealStage[]> = {
  enquiry: ['qualification','lost','cancelled'], qualification: ['sourcing','lost','cancelled'], sourcing: ['proposal','lost','cancelled'],
  proposal: ['viewing','lost','cancelled'], viewing: ['shortlisted','lost','cancelled'], shortlisted: ['negotiation','lost','cancelled'],
  negotiation: ['loi','lost','cancelled'], loi: ['due_diligence','lost','cancelled'], due_diligence: ['tenancy_agreement','spa','lost','cancelled'],
  tenancy_agreement: ['deposit_paid','lost','cancelled'], spa: ['deposit_paid','lost','cancelled'], deposit_paid: ['handover','cancelled'],
  handover: ['completed'], completed: [], lost: [], cancelled: []
};

export function validateDealStageTransition(from: string, to: string) {
  if (!commercialDealStages.includes(from as CommercialDealStage) || !commercialDealStages.includes(to as CommercialDealStage)) return false;
  if (from === to) return true;
  return transitions[from as CommercialDealStage].includes(to as CommercialDealStage);
}

export function nextDealStages(stage: string) {
  return commercialDealStages.includes(stage as CommercialDealStage) ? transitions[stage as CommercialDealStage] : [];
}
