/** Formats confirmed numeric amounts for every human-facing Nexora surface. */
export function formatMYR(value: unknown, fallback = ''): string {
  const amount = typeof value === 'number' ? value : parseMYR(value);
  if (amount === null) return fallback;
  return `RM ${amount.toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/** Converts common Malaysian agreement amounts into a database-safe number. */
export function parseMYR(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const normalized = text
    .replace(/(?:rm|myr)/gi, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}
