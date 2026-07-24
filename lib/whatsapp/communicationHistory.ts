import type { WhatsAppLanguage, WhatsAppTemplateType } from './messageTemplates';

export type WhatsAppCommunicationStatus =
  | 'prepared'
  | 'sent_manually'
  | 'no_answer'
  | 'replied'
  | 'payment_promised'
  | 'follow_up_required'
  | 'wrong_number';

export const whatsappCommunicationStatuses: WhatsAppCommunicationStatus[] = [
  'prepared', 'sent_manually', 'no_answer', 'replied', 'payment_promised', 'follow_up_required', 'wrong_number'
];

export type WhatsAppCommunicationInput = {
  workspaceId: string;
  tenancyId?: string | null;
  contactId: string;
  templateType: WhatsAppTemplateType;
  language: WhatsAppLanguage;
  status: WhatsAppCommunicationStatus;
  message: string;
  followUpDate?: string | null;
  createdBy?: string | null;
  /** Only set when the user explicitly chooses to save the message body as a note. */
  saveMessageBody?: boolean;
};

export type WhatsAppCommunicationRecord = {
  workspace_id: string;
  tenancy_id: string | null;
  contact_id: string;
  channel: 'whatsapp';
  template_type: WhatsAppTemplateType;
  language: WhatsAppLanguage;
  status: WhatsAppCommunicationStatus;
  outcome: string;
  message_template: string;
  note: string;
  content_hash: string;
  follow_up_date: string | null;
  created_by: string | null;
};

/** Deterministic, non-cryptographic content fingerprint. Never used to reconstruct the message. */
export function hashMessageContent(message: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < message.length; index += 1) {
    hash ^= message.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Builds the insert payload for `contact_communications`. By default only template type,
 * language, status, and a content hash are stored -- never the full message body, personal
 * data, or document text -- unless the caller explicitly opts in via `saveMessageBody`.
 */
export function buildWhatsAppCommunicationRecord(input: WhatsAppCommunicationInput): WhatsAppCommunicationRecord {
  return {
    workspace_id: input.workspaceId,
    tenancy_id: input.tenancyId ?? null,
    contact_id: input.contactId,
    channel: 'whatsapp',
    template_type: input.templateType,
    language: input.language,
    status: input.status,
    outcome: input.status,
    message_template: input.templateType,
    note: input.saveMessageBody ? input.message.slice(0, 4000) : '',
    content_hash: hashMessageContent(input.message),
    follow_up_date: input.followUpDate ?? null,
    created_by: input.createdBy ?? null
  };
}
