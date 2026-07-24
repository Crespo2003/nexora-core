import { buildWhatsAppLink, type WhatsAppLinkResult } from './linkBuilder';
import { renderWhatsAppTemplate, type WhatsAppLanguage, type WhatsAppTemplateType, type WhatsAppTemplateVariables } from './messageTemplates';

export type WhatsAppMessageContext = {
  templateType: WhatsAppTemplateType;
  language: WhatsAppLanguage;
  variables: WhatsAppTemplateVariables;
};

/**
 * Provider abstraction so a future official WhatsApp Business Platform (Cloud API) integration
 * can be added without rewriting contact routing or message templates. Only the manual
 * click-to-chat provider is implemented in this phase; the remaining methods are reserved for
 * a future automatic-sending provider and are intentionally not implemented here.
 */
export interface WhatsAppProvider {
  buildMessage(context: WhatsAppMessageContext): string;
  openManualChat(whatsappNumber: string, message: string): WhatsAppLinkResult;
  sendTemplate?(input: unknown): Promise<never>;
  receiveWebhook?(input: unknown): Promise<never>;
  getMessageStatus?(input: unknown): Promise<never>;
}

const notImplemented = (name: string) => async (_input?: unknown): Promise<never> => {
  throw new Error(`whatsapp-${name}-not-available: only the manual click-to-chat provider is implemented in this phase.`);
};

export class ManualWhatsAppProvider implements WhatsAppProvider {
  buildMessage(context: WhatsAppMessageContext): string {
    return renderWhatsAppTemplate(context.templateType, context.language, context.variables);
  }

  /** Never sends automatically; returns a click-to-chat link for the user to review and open themselves. */
  openManualChat(whatsappNumber: string, message: string): WhatsAppLinkResult {
    return buildWhatsAppLink(whatsappNumber, message);
  }

  sendTemplate = notImplemented('send-template');
  receiveWebhook = notImplemented('webhook');
  getMessageStatus = notImplemented('message-status');
}

export const whatsappProvider: WhatsAppProvider = new ManualWhatsAppProvider();
