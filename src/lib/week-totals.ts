export interface DaysLike {
  days: Record<string, number>;
}

/**
 * Sum hours across rows for each date. Rounds to 2 decimals to avoid
 * floating-point artifacts (e.g. 0.1 + 0.2 = 0.30000000000000004).
 */
export function sumHoursByDate(
  rows: Array<DaysLike>,
  dates: Array<string>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const date of dates) {
    const sum = rows.reduce((acc, row) => acc + (row.days[date] ?? 0), 0);
    totals[date] = Math.round(sum * 100) / 100;
  }
  return totals;
}
