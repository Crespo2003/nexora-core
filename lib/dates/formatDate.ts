export const nexoraTimeZone = 'Asia/Kuala_Lumpur';

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const displayDatePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const displayDateTimePattern = /^(\d{2})\/(\d{2})\/(\d{4})(?:[\s,]+(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const namedMonthNumbers: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
};

type DateParts = { year: number; month: number; day: number };

/**
 * Formats a date for every human-facing Nexora surface. Date-only database
 * values are parsed as calendar dates, never as JavaScript timestamps, so a
 * user's timezone cannot move them one day backwards or forwards.
 */
export function formatNexoraDate(value: unknown, fallback = ''): string {
  if (value instanceof Date) return valueToDisplayDate(value, fallback);
  if (typeof value !== 'string') return fallback;

  const text = value.trim();
  if (!text) return fallback;
  const isoParts = datePartsFromIso(text);
  if (isoParts) return displayDate(isoParts);
  if (isoDatePattern.test(text)) return fallback;
  const displayParts = datePartsFromDisplay(text);
  if (displayParts) return displayDate(displayParts);
  // Never guess a slash- or dash-separated date in a non-Nexora order.
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) return fallback;

  return valueToDisplayDate(new Date(text), fallback);
}

/**
 * Normalizes dates recovered from document text. This deliberately accepts
 * common agreement formats such as "1 July 2026" while keeping direct user
 * entry strict through displayDateToIso (DD/MM/YYYY only).
 */
export function formatExtractedNexoraDate(value: unknown, fallback = ''): string {
  const direct = formatNexoraDate(value, '');
  if (direct || typeof value !== 'string') return direct || fallback;

  const text = value.trim();
  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numeric) {
    return formatNexoraDate(`${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`, fallback);
  }

  const named = text.toLowerCase().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})$/);
  const month = named ? namedMonthNumbers[named[2]] : undefined;
  return named && month ? formatNexoraDate(`${named[3]}-${month}-${named[1].padStart(2, '0')}`, fallback) : fallback;
}

/** Formats a timestamp while keeping its date in DD/MM/YYYY form. */
export function formatNexoraDateTime(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    const display = value.trim().match(displayDateTimePattern);
    if (display) {
      const parts = dateParts(Number(display[3]), Number(display[2]), Number(display[1]));
      if (!parts) return fallback;
      const time = display[4] ? ` ${display[4]}:${display[5]}` : '';
      return `${displayDate(parts)}${time}`;
    }
    const dateOnly = datePartsFromIso(value.trim());
    if (dateOnly) return displayDate(dateOnly);
  }

  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return fallback;
  const parts = localeParts(date, { hour: '2-digit', minute: '2-digit' });
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** Converts strict DD/MM/YYYY input to the ISO date stored in the database. */
export function displayDateToIso(displayDate: string): string | null {
  const match = displayDate.trim().match(displayDatePattern);
  if (!match) return null;
  const parts = dateParts(Number(match[3]), Number(match[2]), Number(match[1]));
  return parts ? isoDate(parts) : null;
}

/** Accepts an existing ISO date or strict DD/MM/YYYY input for database writes. */
export function normalizeDateForStorage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const isoParts = datePartsFromIso(text);
  if (isoParts) return isoDate(isoParts);
  return displayDateToIso(text);
}

/** Converts DD/MM/YYYY HH:mm input to an ISO timestamp for database writes. */
export function displayDateTimeToIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();

  // Server-generated timestamps are already storage values. Preserve them so
  // normalizing a mixed payload never drops lifecycle fields such as completed_at.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const match = text.match(displayDateTimePattern);
  if (!match) return null;
  const parts = dateParts(Number(match[3]), Number(match[2]), Number(match[1]));
  if (!parts) return null;
  if (!match[4]) return isoDate(parts);

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  // Malaysia is UTC+08:00 year round. Construct it explicitly rather than
  // relying on the server or browser's local timezone.
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 8, minute, second)).toISOString();
}

export function isValidDisplayDate(displayDate: string): boolean {
  return displayDateToIso(displayDate) !== null;
}

export function compareDisplayDates(left: string, right: string): number | null {
  const leftIso = normalizeDateForStorage(left);
  const rightIso = normalizeDateForStorage(right);
  if (!leftIso || !rightIso) return null;
  return leftIso.localeCompare(rightIso);
}

export function isoToDisplayDate(isoDate: string): string {
  return formatNexoraDate(isoDate);
}

export function isoMonthToDisplayMonth(isoMonth: string): string {
  const match = isoMonth.trim().match(/^(\d{4})-(\d{2})$/);
  return match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? `${match[2]}/${match[1]}` : '';
}

export function currentIsoDate(now = new Date()): string {
  const parts = localeParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function currentIsoMonth(now = new Date()): string {
  return currentIsoDate(now).slice(0, 7);
}

/** Adds calendar days to a database date without involving the host timezone. */
export function addDaysToIsoDate(isoDateValue: string, days: number): string | null {
  const parts = datePartsFromIso(isoDateValue);
  if (!parts || !Number.isInteger(days)) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function datePartsFromIso(value: string): DateParts | null {
  const match = value.match(isoDatePattern);
  return match ? dateParts(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function datePartsFromDisplay(value: string): DateParts | null {
  const match = value.match(displayDatePattern);
  return match ? dateParts(Number(match[3]), Number(match[2]), Number(match[1])) : null;
}

function dateParts(year: number, month: number, day: number): DateParts | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function displayDate(parts: DateParts): string {
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
}

function isoDate(parts: DateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function valueToDisplayDate(date: Date, fallback: string): string {
  if (Number.isNaN(date.getTime())) return fallback;
  const parts = localeParts(date);
  return `${parts.day}/${parts.month}/${parts.year}`;
}

function localeParts(date: Date, options: Intl.DateTimeFormatOptions = {}) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: nexoraTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hourCycle: 'h23',
    ...options
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}
