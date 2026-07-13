import type { DocumentType } from '../documents/types';

export function classifyDocument(text: string, filename: string, mimeType: string): { documentType: DocumentType; confidence: 'high' | 'medium' | 'low' } {
  const source = `${filename}\n${text}`.toLowerCase();

  if (/tenancy agreement|landlord|tenant|monthly rental|security deposit/.test(source)) {
    return { documentType: 'tenancy_agreement', confidence: 'high' };
  }

  if (/renewal/.test(source)) return { documentType: 'tenancy_renewal', confidence: 'medium' };
  if (/letter of offer|offer to rent|offer to purchase/.test(source)) return { documentType: 'letter_of_offer', confidence: 'medium' };
  if (/booking form|booking fee/.test(source)) return { documentType: 'booking_form', confidence: 'medium' };
  if (/sale and purchase|spa|purchase agreement/.test(source)) return { documentType: 'sale_purchase_agreement', confidence: 'medium' };
  if (/passport|identity card|\bic\b|mykad/.test(source)) return { documentType: 'identity_document', confidence: 'medium' };
  if (/ssm|company no|registration no/.test(source)) return { documentType: 'company_document', confidence: 'medium' };
  if (/tnb|water bill|utility|iwk|internet bill/.test(source)) return { documentType: 'utility_bill', confidence: 'medium' };
  if (/inventory|handover|furniture|appliance/.test(source)) return { documentType: 'inventory_list', confidence: 'medium' };

  return {
    documentType: mimeType.startsWith('image/') ? 'identity_document' : 'other',
    confidence: 'low'
  };
}
