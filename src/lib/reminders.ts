// TS-019/020: deadline-derived reminder computation. The list is purely a
// function of the configured deadlines (fiscal.ts + holiday table via
// deadlineForWeek) and current timesheet states — no scheduler, no cron.
// A week qualifies when its submission deadline is today or past AND the
// partner has not submitted (state not_started / in_progress / no row).

import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "@/db";
import {
  holiday as holidayTable,
  reminderLog as reminderLogTable,
  timesheet as timesheetTable,
  user as userTable,
} from "@/db/schema";
import { addWeeks, currentWeek } from "@/lib/fiscal";
import { deadlineForWeek } from "@/lib/holidays";
import { TIMESHEET_EXEMPT_ROLES } from "@/lib/permissions";

/** How many past weeks to scan for outstanding sheets. Matches the
 * compliance window (week-data.ts) so the reminder list can never claim a
 * week the compliance view considers settled. */
const WEEKS_BACK = 4;

export interface ReminderRow {
  userId: string;
  name: string;
  email: string;
  weekStartDate: string;
  deadline: string;
  /** Calendar days the deadline is behind today (0 = due today). */
  daysOverdue: number;
  /** not_started (no sheet or untouched) / in_progress. */
  state: "not_started" | "in_progress";
  /** Latest reminder_log timestamp for this partner/week, if any. */
  lastRemindedAt: Date | null;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

// Candidate weeks whose deadline is today or past. Mirrors
// week-data.ts getOutstandingWeeksBack but keeps the "due today" boundary —
// the compliance export only counts deadline < today.
export async function outstandingDeadlineWeeks(
  holidays: string[],
  today = todayStr(),
): Promise<Array<{ weekStartDate: string; deadline: string }>> {
  const now = currentWeek();
  const weeks: Array<{ weekStartDate: string; deadline: string }> = [];
  for (let i = WEEKS_BACK; i >= 1; i -= 1) {
    const weekStartDate = addWeeks(now, -i);
    const deadline = deadlineForWeek(weekStartDate, holidays);
    if (deadline <= today) {
      weeks.push({ weekStartDate, deadline });
    }
  }
  return weeks;
}

export async function loadHolidayDates(): Promise<string[]> {
  const rows = await db
    .select({ date: holidayTable.observedDate })
    .from(holidayTable);
  return rows.map((h) => h.date);
}

// The full outstanding list: every active, timesheet-filing partner × every
// due/past-due week whose sheet is unsubmitted. Query shape follows
// getComplianceSnapshot (week-data.ts); the "last reminded" column comes
// from a parallel reminder_log fetch keyed by user|week.
export async function getOutstandingReminders(
  holidays?: string[],
): Promise<ReminderRow[]> {
  const allHolidayDates = holidays ?? (await loadHolidayDates());
  const today = todayStr();
  const weeks = await outstandingDeadlineWeeks(allHolidayDates, today);
  if (weeks.length === 0) return [];

  const weekStartDates = weeks.map((w) => w.weekStartDate);

  const [users, sheets, reminders] = await Promise.all([
    db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
      })
      .from(userTable)
      .where(
        and(
          eq(userTable.isActive, true),
          // Read-only roles never file timesheets — same exclusion as the
          // compliance snapshot so the list stays meaningful.
          notInArray(userTable.role, TIMESHEET_EXEMPT_ROLES),
        ),
      )
      .orderBy(userTable.name),
    db
      .select({
        userId: timesheetTable.userId,
        weekStartDate: timesheetTable.weekStartDate,
        state: timesheetTable.state,
      })
      .from(timesheetTable)
      .where(inArray(timesheetTable.weekStartDate, weekStartDates)),
    db
      .select({
        userId: reminderLogTable.userId,
        weekStartDate: reminderLogTable.weekStartDate,
        remindedAt: reminderLogTable.remindedAt,
      })
      .from(reminderLogTable)
      .orderBy(desc(reminderLogTable.remindedAt)),
  ]);

  const stateByUserWeek = new Map(
    sheets.map((s) => [`${s.userId}|${s.weekStartDate}`, s.state]),
  );
  // First hit per pair is the latest timestamp (ordered desc).
  const lastRemindedByUserWeek = new Map(
    reminders.map((r) => [`${r.userId}|${r.weekStartDate}`, r.remindedAt]),
  );

  const rows: ReminderRow[] = [];
  for (const user of users) {
    for (const week of weeks) {
      const state = stateByUserWeek.get(`${user.id}|${week.weekStartDate}`);
      // Unsubmitted only: no sheet at all, or still in progress. Submitted /
      // in_correction / approved / locked sheets are out of scope.
      if (state !== undefined && state !== "not_started" && state !== "in_progress") {
        continue;
      }
      rows.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        weekStartDate: week.weekStartDate,
        deadline: week.deadline,
        daysOverdue: Math.max(0, daysBetween(week.deadline, today)),
        state: state === "in_progress" ? "in_progress" : "not_started",
        lastRemindedAt:
          lastRemindedByUserWeek.get(`${user.id}|${week.weekStartDate}`) ?? null,
      });
    }
  }
  return rows;
}

// Deadline-day note (nice-to-have): normal deadlines land on Mondays
// (Wednesday week start + 12 days); holiday-shifted deadlines land on
// Fridays. True when today IS some week's deadline, or a plain Monday.
export async function isDeadlineDay(
  holidays: string[],
  today = todayStr(),
): Promise<boolean> {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (weekday === 1) return true; // Monday: the regular deadline day
  // Shifted (holiday) deadlines can fall on any weekday — check the window.
  const weeks = await outstandingDeadlineWeeks(holidays, today);
  return weeks.some((w) => w.deadline === today);
}

// Reminder history: recent reminder_log rows with partner + sender names,
// newest first. Drives the history table and the CSV export (same query).
export interface ReminderHistoryRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  weekStartDate: string;
  remindedByName: string;
  remindedAt: Date;
  note: string | null;
}

export function reminderHistoryQuery() {
  // Same table joined twice (partner + sender) — drizzle requires an alias
  // for the second join (same pattern as reports.ts managerUser).
  const remindedByUser = alias(userTable, "reminded_by_user");
  return db
    .select({
      id: reminderLogTable.id,
      userId: reminderLogTable.userId,
      userName: userTable.name,
      userEmail: userTable.email,
      weekStartDate: reminderLogTable.weekStartDate,
      remindedByName: remindedByUser.name,
      remindedAt: reminderLogTable.remindedAt,
      note: reminderLogTable.note,
    })
    .from(reminderLogTable)
    .innerJoin(userTable, eq(reminderLogTable.userId, userTable.id))
    .innerJoin(remindedByUser, eq(reminderLogTable.remindedBy, remindedByUser.id));
}
