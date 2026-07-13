export function isoToDisplayDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

export function displayDateToIso(displayDate: string): string | null {
  const match = displayDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  const isoDate = `${year}-${month}-${day}`;
  const parsed = new Date(`${isoDate}T00:00:00Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return isoDate;
}

export function isValidDisplayDate(displayDate: string): boolean {
  return displayDateToIso(displayDate) !== null;
}

export function compareDisplayDates(left: string, right: string): number | null {
  const leftIso = displayDateToIso(left);
  const rightIso = displayDateToIso(right);

  if (!leftIso || !rightIso) return null;
  return leftIso.localeCompare(rightIso);
}

export function isoMonthToDisplayMonth(isoMonth: string): string {
  const [year, month] = isoMonth.split('-');
  return year && month ? `${month}/${year}` : isoMonth;
}

export function currentIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentIsoMonth(): string {
  return currentIsoDate().slice(0, 7);
}
