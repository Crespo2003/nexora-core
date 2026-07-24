/**
 * Builds WhatsApp click-to-chat links. `https://wa.me/<digits>?text=<encoded>` is the
 * single official Meta link format and resolves automatically to the WhatsApp mobile
 * application, WhatsApp Web, or a desktop browser fallback, so no separate link shapes
 * are required per platform.
 */

export type WhatsAppLinkResult = {
  url: string | null;
  error: 'invalid-whatsapp-number' | 'empty-message' | null;
};

const digitsOnly = (value: string) => value.replace(/\D/g, '');

/** Rejects anything that is not a plausible international WhatsApp number, without guessing. */
export function isValidWhatsAppNumber(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits.length < 8 || digits.length > 15) return false;
  return !/^(\d)\1+$/.test(digits);
}

/**
 * Builds a secure click-to-chat link. The number must already be a normalized
 * WhatsApp-format international number (digits only, no leading `+` or `0`); use
 * `lib/contacts/phone.ts#normalizePhone` first. No internal IDs are ever embedded here.
 */
export function buildWhatsAppLink(whatsappNumber: string, message: string): WhatsAppLinkResult {
  const digits = digitsOnly(whatsappNumber);
  if (!isValidWhatsAppNumber(digits)) return { url: null, error: 'invalid-whatsapp-number' };
  const text = message.trim();
  if (!text) return { url: null, error: 'empty-message' };
  return { url: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`, error: null };
}
