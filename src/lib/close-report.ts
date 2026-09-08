// Exception-report data layer (TS-025 / D6). Extracted from the close export
// route (route files cannot be imported) so the export, the close page's
// exception table, and the close-initiation distribution all read the exact
// same rows — the distributed report can never diverge from what admins see.
// Unlike close.ts (pure rules), this module owns the DB reads.

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  distributionLog as distributionLogTable,
  holiday as holidayTable,
  project as projectTable,
  projectAssignment as projectAssignmentTable,
  timeEntry as timeEntryTable,
  timesheet as timesheetTable,
  user as userTable,
} from "@/db/schema";
import {
  exceptionFlags,
  weeksOfPeriod,
  type CloseSheetState,
  type ExceptionFlag,
} from "@/lib/close";
import { FISCAL_PERIODS } from "@/lib/fiscal";
import { expectedHours } from "@/lib/holidays";

export interface ExceptionRow {
  userId: string;
  name: string;
  email: string;
  team: string | null;
  weekStartDate: string;
  state: CloseSheetState;
  totalHours: number;
  expectedHours: number;
  flags: ExceptionFlag[];
}

/** The export-style exception set: every active partner × period week whose
 * sheet carries an unsubmitted or hours_outlier flag. Tolerance arrives as a
 * parameter so the export route and initiateClose always pass the same
 * admin-configured value (NF-012). Null when the period is unknown or not
 * yet completed (same eligibility as the close page). */
export async function loadExceptionRows(
  fiscalYear: number,
  periodNumber: number,
  tolerance: number,
): Promise<ExceptionRow[] | null> {
  const period = FISCAL_PERIODS.find(
    (p) => p.fiscalYear === fiscalYear && p.periodNumber === periodNumber,
  );
  if (!period) return null;

  // Only completed periods are closeable — same eligibility as the close page.
  const today = new Date().toISOString().slice(0, 10);
  if (period.endDate >= today) return null;

  const weeks = weeksOfPeriod(period);

  const [holidayDates, users, sheets] = await Promise.all([
    db
      .select({ date: holidayTable.observedDate })
      .from(holidayTable)
      .then((rows) => rows.map((h) => h.date)),
    db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        team: userTable.team,
        standardWeeklyHours: userTable.standardWeeklyHours,
      })
      .from(userTable)
      .where(eq(userTable.isActive, true))
      .orderBy(asc(userTable.name)),
    db
      .select({
        userId: timesheetTable.userId,
        weekStartDate: timesheetTable.weekStartDate,
        state: timesheetTable.state,
        totalHours: sql<number>`coalesce(sum(${timeEntryTable.hours}), 0)`,
      })
      .from(timesheetTable)
      .leftJoin(
        timeEntryTable,
        eq(timeEntryTable.timesheetId, timesheetTable.id),
      )
      .where(inArray(timesheetTable.weekStartDate, weeks))
      .groupBy(timesheetTable.id),
  ]);

  const sheetByUserWeek = new Map(
    sheets.map((s) => [`${s.userId}|${s.weekStartDate}`, s]),
  );

  const rows: ExceptionRow[] = [];
  for (const user of users) {
    for (const week of weeks) {
      const sheet = sheetByUserWeek.get(`${user.id}|${week}`);
      const state: CloseSheetState = sheet?.state ?? "not_started";
      const totalHours = sheet ? Number(sheet.totalHours ?? 0) : 0;
      const expected = expectedHours(
        week,
        user.standardWeeklyHours,
        holidayDates,
      );
      const { flags } = exceptionFlags(
        { userId: user.id, state, totalHours, expectedHours: expected },
        tolerance,
      );
      if (flags.length === 0) continue;
      rows.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        team: user.team,
        weekStartDate: week,
        state,
        totalHours,
        expectedHours: expected,
        flags,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Distribution (D6): at close initiation the exception report is emailed to
// the managers of flagged partners and the PMs of affected projects, deduped
// by email address.
// ---------------------------------------------------------------------------

export type DistributionRole = "manager" | "project_manager";

export interface DistributionRecipient {
  email: string;
  role: DistributionRole;
}

/**
 * Recipients for the exception report: managers of flagged partners plus the
 * project managers of projects those partners are actively assigned to.
 * Deduped by email (first occurrence wins — a dual-hatted manager/PM is
 * recorded once, as a manager). Only active recipients with an email are
 * kept; partners without a manager simply contribute no manager recipient.
 */
export async function distributionRecipients(
  rows: ExceptionRow[],
): Promise<DistributionRecipient[]> {
  const flaggedUserIds = [...new Set(rows.map((row) => row.userId))];
  if (flaggedUserIds.length === 0) return [];

  const [flaggedUsers, assignments] = await Promise.all([
    db
      .select({
        id: userTable.id,
        email: userTable.email,
        managerId: userTable.managerId,
      })
      .from(userTable)
      .where(inArray(userTable.id, flaggedUserIds)),
    db
      .select({
        projectId: projectTable.id,
        projectManagerId: projectTable.projectManagerId,
      })
      .from(projectAssignmentTable)
      .innerJoin(
        projectTable,
        eq(projectTable.id, projectAssignmentTable.projectId),
      )
      .where(
        and(
          inArray(projectAssignmentTable.userId, flaggedUserIds),
          isNull(projectAssignmentTable.removedAt),
          eq(projectTable.isActive, true),
        ),
      ),
  ]);

  const recipients = new Map<string, DistributionRecipient>();

  // Managers of flagged partners (active, with a manager on file).
  const managerIds = [
    ...new Set(
      flaggedUsers
        .map((u) => u.managerId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (managerIds.length > 0) {
    const managers = await db
      .select({ email: userTable.email })
      .from(userTable)
      .where(
        and(inArray(userTable.id, managerIds), eq(userTable.isActive, true)),
      );
    for (const manager of managers) {
      if (manager.email && !recipients.has(manager.email)) {
        recipients.set(manager.email, {
          email: manager.email,
          role: "manager",
        });
      }
    }
  }

  // PMs of affected projects (active, with a PM on file).
  const pmIds = [
    ...new Set(
      assignments
        .map((a) => a.projectManagerId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (pmIds.length > 0) {
    const pms = await db
      .select({ email: userTable.email })
      .from(userTable)
      .where(and(inArray(userTable.id, pmIds), eq(userTable.isActive, true)));
    for (const pm of pms) {
      if (pm.email && !recipients.has(pm.email)) {
        recipients.set(pm.email, { email: pm.email, role: "project_manager" });
      }
    }
  }

  return [...recipients.values()];
}

// Distribution status per close (TS-025): one row per recipient per close
// initiation. Consumed by the close page's distribution panel.
export interface DistributionStatusRow {
  id: string;
  recipientEmail: string;
  recipientRole: string;
  sentAt: Date;
  status: "sent" | "would_send" | "failed";
}

export function distributionStatusQuery(closeId: string) {
  return db
    .select({
      id: distributionLogTable.id,
      recipientEmail: distributionLogTable.recipientEmail,
      recipientRole: distributionLogTable.recipientRole,
      sentAt: distributionLogTable.sentAt,
      status: distributionLogTable.status,
    })
    .from(distributionLogTable)
    .where(eq(distributionLogTable.closeId, closeId))
    .orderBy(asc(distributionLogTable.sentAt));
}

/** Convenience wrapper for the close page: distribution rows for one close. */
export async function distributionForClose(
  closeId: string,
): Promise<DistributionStatusRow[]> {
  return distributionStatusQuery(closeId).all();
}

// Re-exported for the export route's CSV/XLSX label mapping.
export const exceptionLabels: Record<ExceptionFlag, string> = {
  unsubmitted: "unsubmitted",
  hours_outlier: "hours_outlier",
};
