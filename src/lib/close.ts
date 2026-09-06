// Pure period-close domain rules (Phase 4, D5). The close cycle:
// exception report → correction window → finalize → unlock. Config values
// (tolerance, window days) arrive as parameters — this module never reads
// config or DB, so server actions stay the only side-effectful layer.

import { addDays, addWeeks } from "./fiscal.ts";
import { isHoliday } from "./holidays.ts";

export type CloseSheetState =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "in_correction"
  | "approved"
  | "locked";

export interface PeriodWeeks {
  startDate: string;
  weekCount: number;
}

export function weeksOfPeriod(period: PeriodWeeks): string[] {
  const weeks: string[] = [];
  let cursor = period.startDate;
  for (let i = 0; i < period.weekCount; i += 1) {
    weeks.push(cursor);
    cursor = addWeeks(cursor, 1);
  }
  return weeks;
}

export type ExceptionFlag = "unsubmitted" | "hours_outlier";

export interface SheetExceptionInput {
  userId: string;
  state: CloseSheetState;
  totalHours: number;
  expectedHours: number;
}

export interface SheetExceptionResult {
  userId: string;
  flags: ExceptionFlag[];
}

function isUnsubmitted(state: CloseSheetState): boolean {
  return state === "not_started" || state === "in_progress";
}

// Outliers only matter for sheets that reached submission; unsubmitted sheets
// are flagged as such instead. Expected of 0 means no baseline to compare
// against (e.g. fully holiday-adjusted week), so the check is skipped.
function isHoursOutlier(
  state: CloseSheetState,
  totalHours: number,
  expectedHours: number,
  tolerance: number,
): boolean {
  if (isUnsubmitted(state)) return false;
  if (expectedHours <= 0) return false;
  return Math.abs(totalHours - expectedHours) / expectedHours > tolerance;
}

export function exceptionFlags(
  input: SheetExceptionInput,
  tolerance: number,
): SheetExceptionResult {
  const flags: ExceptionFlag[] = [];
  if (isUnsubmitted(input.state)) {
    flags.push("unsubmitted");
  }
  if (
    isHoursOutlier(input.state, input.totalHours, input.expectedHours, tolerance)
  ) {
    flags.push("hours_outlier");
  }
  return { userId: input.userId, flags };
}

export function exceptionFlagsForPeriod(
  sheets: SheetExceptionInput[],
  tolerance: number,
): SheetExceptionResult[] {
  return sheets.map((sheet) => exceptionFlags(sheet, tolerance));
}

// D5: finalize is enabled once the correction window has elapsed, or earlier
// when every sheet is settled (submitted-or-better; nothing still open or
// awaiting correction).
function isSettled(state: CloseSheetState): boolean {
  return (
    state === "submitted" ||
    state === "approved" ||
    state === "locked"
  );
}

export function canFinalize(
  sheets: Array<Pick<SheetExceptionInput, "state">>,
  windowElapsed: boolean,
): boolean {
  if (windowElapsed) return true;
  return sheets.every((sheet) => isSettled(sheet.state));
}

function isBusinessDay(dateStr: string, holidays: string[]): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isHoliday(dateStr, holidays);
}

// Adds N business days (Mon–Fri, skipping observed holidays) to the close
// initiation timestamp. Holidays are YYYY-MM-DD strings from the same
// holiday rules used for deadlines (holidays.ts). The window stays open
// through the end of the final business day (23:59:59.999 UTC), so partners
// keep the whole last day to resubmit corrections.
export function correctionWindowEndsAt(
  closeInitiatedAt: Date,
  holidays: string[],
  days: number,
): Date {
  // Work on the UTC calendar date so the window is deterministic regardless
  // of the server's local timezone.
  let cursor = closeInitiatedAt.toISOString().slice(0, 10);
  let remaining = days;
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor, holidays)) {
      remaining -= 1;
    }
  }
  return new Date(`${cursor}T23:59:59.999Z`);
}
