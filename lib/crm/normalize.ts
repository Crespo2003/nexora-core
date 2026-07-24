export function normalizeCrmPhone(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('60')) return `+${digits}`;
  if (digits.startsWith('0')) return `+60${digits.slice(1)}`;
  return `+${digits}`;
}

export function normalizeCrmEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeCrmText(value: unknown, max = 2_000) {
  return String(value ?? '').trim().slice(0, max);
}

export function normalizeStringList(value: unknown, maxItems = 20) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(',');
  return items
    .map((item) => normalizeCrmText(item, 160))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function nullableNumber(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeHttpUrl(value: unknown) {
  const raw = normalizeCrmText(value, 1_000);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}
