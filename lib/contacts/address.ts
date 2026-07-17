export type StructuredAddress = {
  propertyName: string; block: string; unitNumber: string; floor: string; street: string; area: string; postcode: string; city: string; state: string; country: string; fullAddress: string; originalAddress: string; confidence: number;
};

const states = ['Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Penang', 'Perak', 'Perlis', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'Kuala Lumpur', 'Putrajaya', 'Labuan'];

export function normalizePropertyAddress(value: unknown): StructuredAddress {
  const originalAddress = typeof value === 'string' ? value.trim() : '';
  const cleaned = originalAddress.replace(/\s+/g, ' ').replace(/(?:,\s*){2,}/g, ', ').trim();
  const postcode = cleaned.match(/\b(\d{5})\b/)?.[1] ?? '';
  const state = states.find((candidate) => new RegExp(`\\b${candidate.replace(' ', '\\s+')}\\b`, 'i').test(cleaned)) ?? '';
  const unitNumber = cleaned.match(/(?:unit|no\.?|#)\s*([\w-]+(?:\s*[-/]\s*[\w-]+)?)/i)?.[1] ?? '';
  const block = cleaned.match(/\b(?:block|tower|jalan|lorong)\s+([^,]+)/i)?.[0] ?? '';
  const city = postcode ? cleaned.split(postcode).at(-1)?.split(',')[0]?.trim() ?? '' : '';
  const country = /malaysia/i.test(cleaned) || state ? 'Malaysia' : '';
  return { propertyName: '', block, unitNumber, floor: '', street: '', area: '', postcode, city, state, country, fullAddress: cleaned, originalAddress, confidence: cleaned ? (postcode && state ? 90 : 55) : 0 };
}
