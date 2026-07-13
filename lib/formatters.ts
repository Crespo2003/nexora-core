export function formatMYR(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `RM ${safeValue.toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}
