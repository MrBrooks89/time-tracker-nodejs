// FC-010: holiday Out of Office pre-population — pure logic only.
// No `@/db` import here: node:test loads this module directly, and the DB
// side of pre-population lives in week-data.ts (ensureHolidayOooEntries).

import { weekDates } from "./fiscal.ts";

export const OOO_CATEGORY_NAME = "Out of Office";
export const OOO_NOTE = "Company holiday (auto)";

export interface HolidayOooEntry {
  date: string;
  hours: number;
  note: string;
  categoryName: string;
}

// Day-fraction of standard hours for a single holiday, rounded to 0.25h —
// the same per-day term holidays.ts expectedHours subtracts
// (standard − (standard / 5) × holidayCount), so a week's OOO entries
// account for exactly the adjustment the expected-hours meter applies.
export function holidayDayFraction(standardWeeklyHours: number): number {
  return Math.round((standardWeeklyHours / 5) * 4) / 4;
}

// OOO entries to pre-populate for the observed holidays falling inside a
// Wed–Tue week. One entry per holiday date, hours = day-fraction.
export function holidayOooEntries(
  weekStartDate: string,
  holidays: Array<{ name: string; date: string }>,
  standardWeeklyHours: number,
): HolidayOooEntry[] {
  const weekDays = new Set(weekDates(weekStartDate));
  const hours = holidayDayFraction(standardWeeklyHours);

  return holidays
    .filter((h) => weekDays.has(h.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((h) => ({
      date: h.date,
      hours,
      note: OOO_NOTE,
      categoryName: OOO_CATEGORY_NAME,
    }));
}

// Idempotency filter: skip a holiday date if ANY time entry already exists
// for that date in the timesheet (any row — project or non-project).
// Pre-population must never overwrite or duplicate partner-entered data, so
// the widest rule wins: one entry covering the date suppresses the insert.
export function filterExisting(
  entries: HolidayOooEntry[],
  existingEntryDates: Iterable<string>,
): HolidayOooEntry[] {
  const existing = new Set(existingEntryDates);
  return entries.filter((e) => !existing.has(e.date));
}

// Editable timesheet states for pre-population: draft-like states only.
// Submitted / in_correction / approved / locked weeks never auto-fill.
export function isEditableTimesheetState(state: string): boolean {
  return state === "not_started" || state === "in_progress";
}
