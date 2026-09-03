export function isValidHoursIncrement(hours: number): boolean {
  if (!Number.isFinite(hours) || hours < 0) return false;
  const quarters = hours * 4;
  return Math.abs(quarters - Math.round(quarters)) < 1e-9;
}

export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 4) / 4;
  const formatted = Number.isInteger(rounded)
    ? String(rounded)
    : String(Number(rounded.toFixed(2)));
  return `${formatted}h`;
}
