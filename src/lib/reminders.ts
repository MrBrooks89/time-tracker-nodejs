// TS-019/020: deadline-derived reminder computation. The list is purely a
// function of the configured deadlines (fiscal.ts + holiday table via
// deadlineForWeek) and current timesheet states. A week qualifies when its
// submission deadline is today or past AND the partner has not submitted
// (state not_started / in_progress / no row). Also hosts the D7 scheduled
// deadline-day runner (maybeRunScheduledReminders) — idempotent, invoked
// lazily from the app layout and from /api/reminders/run for external cron.

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
import { buildReminderEmail, renderTemplate } from "@/lib/email";
import { deadlineForWeek, expectedHours } from "@/lib/holidays";
import { isMailConfigured, sendMail } from "@/lib/mailer";
import { TIMESHEET_EXEMPT_ROLES } from "@/lib/permissions";
import { getSettings } from "@/lib/settings-db";

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
  /** Holiday-adjusted expected hours for the week — the {hours} placeholder
   * in the reminder templates. */
  expectedHours: number;
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
        standardWeeklyHours: userTable.standardWeeklyHours,
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
        expectedHours: expectedHours(
          week.weekStartDate,
          user.standardWeeklyHours,
          allHolidayDates,
        ),
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

// ---------------------------------------------------------------------------
// Scheduled reminders (D7): deadline-day auto-send, invoked lazily from the
// authenticated layout (after()) and from /api/reminders/run for external
// cron. Idempotent via the (trigger="scheduled", weekStartDate, recipient)
// marker — one scheduled send per recipient per deadline day.
// ---------------------------------------------------------------------------

export interface ScheduledRunResult {
  /** False when today is not a deadline day (nothing attempted). */
  ran: boolean;
  /** Reminder rows recorded by this run. */
  sent: number;
  /** Outstanding rows skipped because a scheduled marker already exists. */
  skipped: number;
  channel: "email" | "in_app" | null;
  error?: string;
}

/**
 * Runs the scheduled deadline-day reminders. Never throws: every failure is
 * caught and reported in the result so a layout render or cron HTTP call can
 * never break because of it.
 *
 * Race safety: the idempotency marker rows are committed BEFORE any email is
 * dispatched (claim-then-send). A concurrent run — a second RSC navigation
 * racing the cron route — sees the committed markers inside its own
 * transaction and skips those recipients, so one deadline day can never
 * double-send. Rows start as "would_send" and are flipped to sent/failed
 * after each transport attempt; in log-only mode they stay "would_send" (D5).
 */
export async function maybeRunScheduledReminders(): Promise<ScheduledRunResult> {
  try {
    const holidays = await loadHolidayDates();
    const today = todayStr();
    if (!(await isDeadlineDay(holidays, today))) {
      return { ran: false, sent: 0, skipped: 0, channel: null };
    }

    const outstanding = await getOutstandingReminders(holidays);
    if (outstanding.length === 0) {
      return { ran: true, sent: 0, skipped: 0, channel: null };
    }

    const configured = isMailConfigured();
    const channel: "email" | "in_app" = configured ? "email" : "in_app";
    const weekStartDates = [...new Set(outstanding.map((r) => r.weekStartDate))];

    // Claim phase (single sync transaction): read the existing scheduled
    // markers for the outstanding weeks, then insert one marker row per
    // still-pending recipient. Committed before any send.
    const claimed = db.transaction((tx) => {
      const existing = tx
        .select({
          userId: reminderLogTable.userId,
          weekStartDate: reminderLogTable.weekStartDate,
        })
        .from(reminderLogTable)
        .where(
          and(
            eq(reminderLogTable.trigger, "scheduled"),
            inArray(reminderLogTable.weekStartDate, weekStartDates),
          ),
        )
        .all();
      const done = new Set(
        existing.map((row) => `${row.userId}|${row.weekStartDate}`),
      );
      const pending: Array<ReminderRow & { logId: string }> = [];
      for (const row of outstanding) {
        if (done.has(`${row.userId}|${row.weekStartDate}`)) continue;
        const logId = crypto.randomUUID();
        pending.push({ ...row, logId });
        tx.insert(reminderLogTable)
          .values({
            id: logId,
            userId: row.userId,
            weekStartDate: row.weekStartDate,
            remindedBy: null, // scheduled — no acting admin
            remindedAt: new Date(),
            note: null,
            channel,
            status: "would_send",
            recipient: row.email,
            trigger: "scheduled",
          })
          .run();
      }
      return pending;
    });

    const skipped = outstanding.length - claimed.length;
    if (claimed.length === 0) {
      return { ran: true, sent: 0, skipped, channel };
    }

    if (!configured) {
      // Log-only mode (D5): rows stay "would_send", nothing dispatched.
      return { ran: true, sent: claimed.length, skipped, channel };
    }

    // Send phase: render from the admin-editable templates and dispatch one
    // email per outstanding week. A transport failure marks that row
    // "failed" and never aborts the batch.
    const settings = await getSettings();
    const outcomes: Array<{ id: string; status: "sent" | "failed" }> = [];
    for (const row of claimed) {
      const email = buildReminderEmail(
        { subject: settings.reminderSubject, body: settings.reminderBody },
        { partner: row.name, weekStartDate: row.weekStartDate, deadline: row.deadline },
      );
      const result = await sendMail({
        to: row.email,
        subject: renderTemplate(email.subject, { hours: row.expectedHours }),
        body: renderTemplate(email.body, { hours: row.expectedHours }),
      });
      if (result.status === "sent" || result.status === "failed") {
        outcomes.push({ id: row.logId, status: result.status });
      }
    }

    if (outcomes.length > 0) {
      db.transaction((tx) => {
        for (const outcome of outcomes) {
          tx.update(reminderLogTable)
            .set({ status: outcome.status })
            .where(eq(reminderLogTable.id, outcome.id))
            .run();
        }
      });
    }

    return { ran: true, sent: claimed.length, skipped, channel };
  } catch (error) {
    return {
      ran: true,
      sent: 0,
      skipped: 0,
      channel: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Reminder history: recent reminder_log rows with partner + sender names,
// newest first. Drives the history table and the CSV export (same query).
// The sender join is a LEFT join: scheduled sends have no acting admin
// (remindedBy is null) and must still appear in the history.
export interface ReminderHistoryRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  weekStartDate: string;
  remindedByName: string | null;
  remindedAt: Date;
  note: string | null;
  channel: "in_app" | "email";
  status: "sent" | "would_send" | "failed";
  recipient: string | null;
  trigger: "manual" | "scheduled";
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
      channel: reminderLogTable.channel,
      status: reminderLogTable.status,
      recipient: reminderLogTable.recipient,
      trigger: reminderLogTable.trigger,
    })
    .from(reminderLogTable)
    .innerJoin(userTable, eq(reminderLogTable.userId, userTable.id))
    .leftJoin(remindedByUser, eq(reminderLogTable.remindedBy, remindedByUser.id));
}
