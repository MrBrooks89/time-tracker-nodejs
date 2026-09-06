export interface FiscalPeriodInfo {
  fiscalYear: number;
  quarter: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  weekCount: number;
}

export interface FiscalWeekInfo {
  weekStartDate: string;
  period: FiscalPeriodInfo;
  weekIndex: number;
}

export const FISCAL_PERIODS: FiscalPeriodInfo[] = [
  { fiscalYear: 2026, quarter: 1, periodNumber: 1, startDate: "2025-10-01", endDate: "2025-10-28", weekCount: 4 },
  { fiscalYear: 2026, quarter: 1, periodNumber: 2, startDate: "2025-10-29", endDate: "2025-12-02", weekCount: 5 },
  { fiscalYear: 2026, quarter: 1, periodNumber: 3, startDate: "2025-12-03", endDate: "2026-01-06", weekCount: 5 },
  { fiscalYear: 2026, quarter: 2, periodNumber: 4, startDate: "2026-01-07", endDate: "2026-02-03", weekCount: 4 },
  { fiscalYear: 2026, quarter: 2, periodNumber: 5, startDate: "2026-02-04", endDate: "2026-03-10", weekCount: 5 },
  { fiscalYear: 2026, quarter: 2, periodNumber: 6, startDate: "2026-03-11", endDate: "2026-04-07", weekCount: 4 },
  { fiscalYear: 2026, quarter: 3, periodNumber: 7, startDate: "2026-04-08", endDate: "2026-05-05", weekCount: 4 },
  { fiscalYear: 2026, quarter: 3, periodNumber: 8, startDate: "2026-05-06", endDate: "2026-06-09", weekCount: 5 },
  { fiscalYear: 2026, quarter: 3, periodNumber: 9, startDate: "2026-06-10", endDate: "2026-07-07", weekCount: 4 },
  { fiscalYear: 2026, quarter: 4, periodNumber: 10, startDate: "2026-07-08", endDate: "2026-08-04", weekCount: 4 },
  { fiscalYear: 2026, quarter: 4, periodNumber: 11, startDate: "2026-08-05", endDate: "2026-09-01", weekCount: 4 },
  { fiscalYear: 2026, quarter: 4, periodNumber: 12, startDate: "2026-09-02", endDate: "2026-09-29", weekCount: 4 },
  { fiscalYear: 2027, quarter: 1, periodNumber: 1, startDate: "2026-09-30", endDate: "2026-10-27", weekCount: 4 },
  { fiscalYear: 2027, quarter: 1, periodNumber: 2, startDate: "2026-10-28", endDate: "2026-12-01", weekCount: 5 },
  { fiscalYear: 2027, quarter: 1, periodNumber: 3, startDate: "2026-12-02", endDate: "2027-01-05", weekCount: 5 },
  { fiscalYear: 2027, quarter: 2, periodNumber: 4, startDate: "2027-01-06", endDate: "2027-02-02", weekCount: 4 },
  { fiscalYear: 2027, quarter: 2, periodNumber: 5, startDate: "2027-02-03", endDate: "2027-03-09", weekCount: 5 },
  { fiscalYear: 2027, quarter: 2, periodNumber: 6, startDate: "2027-03-10", endDate: "2027-04-06", weekCount: 4 },
  { fiscalYear: 2027, quarter: 3, periodNumber: 7, startDate: "2027-04-07", endDate: "2027-05-04", weekCount: 4 },
  { fiscalYear: 2027, quarter: 3, periodNumber: 8, startDate: "2027-05-05", endDate: "2027-06-08", weekCount: 5 },
  { fiscalYear: 2027, quarter: 3, periodNumber: 9, startDate: "2027-06-09", endDate: "2027-07-06", weekCount: 4 },
  { fiscalYear: 2027, quarter: 4, periodNumber: 10, startDate: "2027-07-07", endDate: "2027-08-03", weekCount: 4 },
  { fiscalYear: 2027, quarter: 4, periodNumber: 11, startDate: "2027-08-04", endDate: "2027-08-31", weekCount: 4 },
  { fiscalYear: 2027, quarter: 4, periodNumber: 12, startDate: "2027-09-01", endDate: "2027-09-28", weekCount: 4 },
];

function parseDate(s: string): { year: number; month: number; day: number } {
  const [year, month, day] = s.split("-").map(Number);
  return { year, month, day };
}

function formatDate(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function dateToUtc(s: string): number {
  const { year, month, day } = parseDate(s);
  return Date.UTC(year, month - 1, day);
}

function utcToDate(ms: number): { year: number; month: number; day: number; weekday: number } {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
}

const MS_PER_DAY = 86_400_000;

export function addDays(dateStr: string, n: number): string {
  const d = utcToDate(dateToUtc(dateStr) + n * MS_PER_DAY);
  return formatDate(d.year, d.month, d.day);
}

export function weekStart(date: Date): string {
  const local = formatDate(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  const ms = dateToUtc(local);
  const { weekday } = utcToDate(ms);
  const daysSinceWednesday = (weekday + 7 - 3) % 7;
  return addDays(local, -daysSinceWednesday);
}

export function addWeeks(weekStartDate: string, n: number): string {
  return addDays(weekStartDate, n * 7);
}

export function isWeekStart(s: string): boolean {
  const { weekday } = utcToDate(dateToUtc(s));
  return weekday === 3;
}

export function findPeriod(date: string): FiscalPeriodInfo | null {
  for (const period of allPeriods()) {
    if (date >= period.startDate && date <= period.endDate) {
      return period;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Period generation (FC-008): the 4-4-5 pattern encoded by FISCAL_PERIODS.
// Per quarter the 12 periods run 4-5-5 / 4-5-4 / 4-5-4 / 4-4-4 weeks —
// 52 weeks (364 days) per fiscal year, Wednesday starts, Tuesday ends.
// Single source of truth for the calendar admin's future-year generation.
// ---------------------------------------------------------------------------

const PERIOD_WEEK_COUNTS = [4, 5, 5, 4, 5, 4, 4, 5, 4, 4, 4, 4] as const;

export function generateFiscalYearPeriods(
  year: number,
  firstPeriodStart: string,
): FiscalPeriodInfo[] {
  const periods: FiscalPeriodInfo[] = [];
  let cursor = firstPeriodStart;
  for (let i = 0; i < 12; i += 1) {
    const periodNumber = i + 1;
    const weekCount = PERIOD_WEEK_COUNTS[i];
    const endDate = addDays(cursor, weekCount * 7 - 1);
    periods.push({
      fiscalYear: year,
      quarter: Math.floor(i / 3) + 1,
      periodNumber,
      startDate: cursor,
      endDate,
      weekCount,
    });
    cursor = addDays(endDate, 1);
  }
  return periods;
}

// DB-backed runtime period index (FC-008): periods generated by the calendar
// admin live in the fiscal_period table; registering them here lets
// findPeriod/findWeek resolve future years immediately — no caching layer,
// each request re-reads and re-registers from the DB.
const runtimePeriods = new Map<string, FiscalPeriodInfo>();

export function registerPeriods(periods: FiscalPeriodInfo[]): void {
  for (const period of periods) {
    runtimePeriods.set(`${period.fiscalYear}-${period.periodNumber}`, period);
  }
}

/** All known periods: static baseline + DB-generated overrides, date-ordered. */
export function allPeriods(): FiscalPeriodInfo[] {
  const merged = new Map<string, FiscalPeriodInfo>(
    FISCAL_PERIODS.map((p) => [`${p.fiscalYear}-${p.periodNumber}`, p]),
  );
  for (const [key, period] of runtimePeriods) {
    merged.set(key, period);
  }
  return [...merged.values()].sort((a, b) =>
    a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0,
  );
}

function normalizeToWeekStart(date: string | Date): string {
  if (typeof date === "string") {
    return isWeekStart(date) ? date : weekStart(new Date(`${date}T12:00:00`));
  }
  return weekStart(date);
}

export function findWeek(date: string | Date): FiscalWeekInfo | null {
  const weekStartDate = normalizeToWeekStart(date);
  const period = findPeriod(weekStartDate);
  if (!period) return null;
  let cursor = period.startDate;
  for (let weekIndex = 1; weekIndex <= period.weekCount; weekIndex += 1) {
    if (cursor === weekStartDate) {
      return { weekStartDate, period, weekIndex };
    }
    cursor = addWeeks(cursor, 1);
  }
  return null;
}

export function weeksInPeriod(period: FiscalPeriodInfo): string[] {
  const weeks: string[] = [];
  let cursor = period.startDate;
  for (let i = 0; i < period.weekCount; i += 1) {
    weeks.push(cursor);
    cursor = addWeeks(cursor, 1);
  }
  return weeks;
}

export function weekDates(weekStartDate: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i));
}

export function currentWeek(today = new Date()): string {
  return weekStart(today);
}

export function weekEnterable(weekStartDate: string, today = new Date()): boolean {
  return weekStartDate <= currentWeek(today);
}
