export type PhoneNormalization = {
  original: string;
  normalized: string;
  countryCode: string;
  nationalNumber: string;
  display: string;
  whatsappNumber: string;
  isMalaysian: boolean;
  confidence: 'high' | 'review';
  reason: string | null;
};

const empty = (original: string, reason: string): PhoneNormalization => ({
  original, normalized: '', countryCode: '', nationalNumber: '', display: '', whatsappNumber: '', isMalaysian: false, confidence: 'review', reason
});

/** Normalizes Malaysian and foreign telephone numbers without guessing identifiers as phones. */
export function normalizePhone(value: unknown): PhoneNormalization {
  const original = typeof value === 'string' ? value.trim() : '';
  if (!original) return empty('', 'missing');
  if (/\b(?:rm|myr)\b/i.test(original) || /\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(original)) return empty(original, 'not-a-phone-number');
  const hasPlus = original.startsWith('+');
  const digits = original.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || /^(\d)\1{6,}$/.test(digits)) return empty(original, 'invalid-length');

  const malaysiaDigits = digits.startsWith('60') ? digits.slice(2) : digits.startsWith('0') ? digits.slice(1) : '';
  if (malaysiaDigits) {
    if (!/^(?:1\d{7,9}|[3-9]\d{7,9})$/.test(malaysiaDigits)) return empty(original, 'invalid-malaysian-number');
    const normalized = `+60${malaysiaDigits}`;
    const mobile = malaysiaDigits.startsWith('1');
    const display = mobile
      ? `+60 ${malaysiaDigits.slice(0, 2)}-${malaysiaDigits.slice(2, 5)} ${malaysiaDigits.slice(5)}`
      : `+60 ${malaysiaDigits.slice(0, 1)}-${malaysiaDigits.slice(1, 5)} ${malaysiaDigits.slice(5)}`;
    return { original, normalized, countryCode: '+60', nationalNumber: `0${malaysiaDigits}`, display, whatsappNumber: `60${malaysiaDigits}`, isMalaysian: true, confidence: 'high', reason: null };
  }

  if (!hasPlus) return empty(original, 'missing-country-code');
  const match = original.match(/^\+(\d{1,3})[\s-]*([\d\s-]+)$/);
  if (!match) return empty(original, 'invalid-international-number');
  const nationalNumber = match[2].replace(/\D/g, '');
  return { original, normalized: `+${match[1]}${nationalNumber}`, countryCode: `+${match[1]}`, nationalNumber, display: `+${match[1]} ${nationalNumber}`, whatsappNumber: `${match[1]}${nationalNumber}`, isMalaysian: false, confidence: 'review', reason: 'foreign-number-preserved' };
}

export function isConfirmedCollectionContact(contact: { role?: string; represents?: string; collectionAuthorized?: boolean }) {
  if (contact.collectionAuthorized) return true;
  const role = String(contact.role ?? '').toLowerCase();
  const represents = String(contact.represents ?? '').toLowerCase();
  return represents === 'tenant' && /tenant|representative|agent|guarantor/.test(role) && !/^witness$/.test(role);
}
