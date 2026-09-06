"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  holiday as holidayTable,
  periodClose as periodCloseTable,
  timeEntry as timeEntryTable,
  timesheet as timesheetTable,
  user as userTable,
} from "@/db/schema";
import {
  correctionWindowEndsAt,
  exceptionFlags,
  weeksOfPeriod,
} from "@/lib/close";
import { CORRECTION_WINDOW_DAYS, HOURS_TOLERANCE } from "@/lib/config";
import { FISCAL_PERIODS, type FiscalPeriodInfo } from "@/lib/fiscal";
import { expectedHours } from "@/lib/holidays";
import { requireRole } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// DA-009: periods have no surrogate id in the close flow — the composite
// fiscal coordinates are the stable, human-readable entity key.
function periodEntityId(fiscalYear: number, periodNumber: number): string {
  return `FY${fiscalYear}-P${periodNumber}`;
}

function findFiscalPeriod(
  fiscalYear: number,
  periodNumber: number,
): FiscalPeriodInfo | null {
  return (
    FISCAL_PERIODS.find(
      (p) => p.fiscalYear === fiscalYear && p.periodNumber === periodNumber,
    ) ?? null
  );
}

async function loadHolidayDates(): Promise<string[]> {
  const rows = await db
    .select({ date: holidayTable.observedDate })
    .from(holidayTable);
  return rows.map((h) => h.date);
}

function revalidateClosePaths() {
  revalidatePath("/close");
  revalidatePath("/week");
  revalidatePath("/");
  revalidatePath("/reports");
}

// Existing sheets of one period with holiday-adjusted expected hours, for
// exception flagging (TS-024). Partners who never opened a week have no
// timesheet row and are therefore never touched by initiate/finalize.
async function loadPeriodSheets(
  period: FiscalPeriodInfo,
  holidayDates: string[],
) {
  const weeks = weeksOfPeriod(period);

  const rows = await db
    .select({
      id: timesheetTable.id,
      userId: timesheetTable.userId,
      weekStartDate: timesheetTable.weekStartDate,
      state: timesheetTable.state,
      totalHours: sql<number>`coalesce(sum(${timeEntryTable.hours}), 0)`,
      standardWeeklyHours: userTable.standardWeeklyHours,
    })
    .from(timesheetTable)
    .innerJoin(userTable, eq(timesheetTable.userId, userTable.id))
    .leftJoin(timeEntryTable, eq(timeEntryTable.timesheetId, timesheetTable.id))
    .where(inArray(timesheetTable.weekStartDate, weeks))
    .groupBy(timesheetTable.id);

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    state: row.state,
    totalHours: Number(row.totalHours ?? 0),
    expectedHours: expectedHours(
      row.weekStartDate,
      row.standardWeeklyHours,
      holidayDates,
    ),
  }));
}

// D5: initiate the close cycle — open the correction window and flag outlier
// sheets for correction. Unsubmitted sheets stay as-is (they lock as-is at
// finalize per D1); submittedAt is preserved as resubmission evidence.
export async function initiateClose(
  fiscalYear: number,
  periodNumber: number,
): Promise<ActionResult> {
  const sessionUser = await requireRole(["admin"]);

  const period = findFiscalPeriod(fiscalYear, periodNumber);
  if (!period) {
    return { ok: false, error: "Unknown fiscal period." };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (period.endDate >= today) {
    return { ok: false, error: "Only completed periods can be closed." };
  }

  const [existing] = await db
    .select({ id: periodCloseTable.id })
    .from(periodCloseTable)
    .where(
      and(
        eq(periodCloseTable.fiscalYear, fiscalYear),
        eq(periodCloseTable.periodNumber, periodNumber),
      ),
    )
    .limit(1);
  if (existing) {
    return { ok: false, error: "Close has already been initiated for this period." };
  }

  const holidayDates = await loadHolidayDates();
  const sheets = await loadPeriodSheets(period, holidayDates);

  const flaggedIds = sheets
    .filter((sheet) => {
      const { flags } = exceptionFlags(
        {
          userId: sheet.userId,
          state: sheet.state,
          totalHours: sheet.totalHours,
          expectedHours: sheet.expectedHours,
        },
        HOURS_TOLERANCE,
      );
      return flags.includes("hours_outlier");
    })
    .map((sheet) => sheet.id);

  const windowEndsAt = correctionWindowEndsAt(
    new Date(),
    holidayDates,
    CORRECTION_WINDOW_DAYS,
  );

  // Sync callback + .run(): better-sqlite3 transactions reject promise-
  // returning callbacks, so all statements execute synchronously.
  db.transaction((tx) => {
    tx.insert(periodCloseTable)
      .values({
        id: crypto.randomUUID(),
        fiscalYear,
        periodNumber,
        correctionWindowEndsAt: windowEndsAt,
        closedAt: null,
        closedBy: null,
      })
      .run();

    if (flaggedIds.length > 0) {
      tx.update(timesheetTable)
        .set({ state: "in_correction" })
        .where(inArray(timesheetTable.id, flaggedIds))
        .run();
    }

    // DA-009: close initiation is a compliance event — atomically audited
    // with the flagged-sheet state flips.
    recordAudit(tx, {
      actorId: sessionUser.id,
      action: "close_initiate",
      entityType: "period",
      entityId: periodEntityId(fiscalYear, periodNumber),
      newValue: `flagged=${flaggedIds.length}`,
    });
  });

  revalidateClosePaths();
  return { ok: true };
}

// D1 gate (user-approved decision): before the correction window elapses,
// finalize is blocked while any sheet still awaits approval (submitted) or is
// mid-fix (in_correction). Unsubmitted sheets (in_progress/not_started) do
// NOT block — they lock as-is today, per D1. Once the window has elapsed,
// everything locks regardless.
export async function finalizeClose(
  fiscalYear: number,
  periodNumber: number,
): Promise<ActionResult> {
  const sessionUser = await requireRole(["admin"]);

  const period = findFiscalPeriod(fiscalYear, periodNumber);
  if (!period) {
    return { ok: false, error: "Unknown fiscal period." };
  }

  const [close] = await db
    .select()
    .from(periodCloseTable)
    .where(
      and(
        eq(periodCloseTable.fiscalYear, fiscalYear),
        eq(periodCloseTable.periodNumber, periodNumber),
      ),
    )
    .limit(1);
  if (!close) {
    return { ok: false, error: "Initiate the close before finalizing." };
  }
  if (close.closedAt !== null) {
    return { ok: false, error: "This period is already closed." };
  }

  const weeks = weeksOfPeriod(period);
  const sheets = await db
    .select({ state: timesheetTable.state })
    .from(timesheetTable)
    .where(inArray(timesheetTable.weekStartDate, weeks));

  const windowElapsed =
    close.correctionWindowEndsAt === null ||
    new Date() >= close.correctionWindowEndsAt;

  if (!windowElapsed) {
    const awaiting = sheets.filter((s) => s.state === "submitted").length;
    const inCorrection = sheets.filter((s) => s.state === "in_correction").length;
    if (awaiting > 0 || inCorrection > 0) {
      const parts: string[] = [];
      if (awaiting > 0) {
        parts.push(
          `${awaiting} sheet${awaiting === 1 ? "" : "s"} awaiting approval`,
        );
      }
      if (inCorrection > 0) {
        parts.push(
          `${inCorrection} in correction`,
        );
      }
      return {
        ok: false,
        error: `${parts.join(", ")} — finalize after the correction window ends or once they are settled.`,
      };
    }
  }

  // Gate passed: lock every existing sheet row in the period. not_started
  // weeks have no row and stay not_started; the period is closed regardless.
  db.transaction((tx) => {
    tx.update(timesheetTable)
      .set({ state: "locked" })
      .where(
        and(
          inArray(timesheetTable.weekStartDate, weeks),
          inArray(timesheetTable.state, [
            "submitted",
            "approved",
            "in_correction",
            "in_progress",
          ]),
        ),
      )
      .run();

    tx.update(periodCloseTable)
      .set({ closedAt: new Date(), closedBy: sessionUser.id })
      .where(eq(periodCloseTable.id, close.id))
      .run();

    // DA-009: finalization locks the whole period — atomically audited.
    recordAudit(tx, {
      actorId: sessionUser.id,
      action: "close_finalize",
      entityType: "period",
      entityId: periodEntityId(fiscalYear, periodNumber),
      newValue: "locked",
    });
  });

  revalidateClosePaths();
  return { ok: true };
}

// Reopen a finalized period: drop the periodClose row and restore locked
// sheets from evidence (approvedAt → approved, submittedAt → submitted, else
// in_progress). not_started weeks never had a row, so they need no restore.
export async function reopenPeriod(
  fiscalYear: number,
  periodNumber: number,
): Promise<ActionResult> {
  const sessionUser = await requireRole(["admin"]);

  const [close] = await db
    .select()
    .from(periodCloseTable)
    .where(
      and(
        eq(periodCloseTable.fiscalYear, fiscalYear),
        eq(periodCloseTable.periodNumber, periodNumber),
      ),
    )
    .limit(1);
  if (!close) {
    return { ok: false, error: "This period is not closed." };
  }
  if (close.closedAt === null) {
    return { ok: false, error: "This period has not been finalized yet." };
  }

  const period = findFiscalPeriod(fiscalYear, periodNumber);
  if (!period) {
    return { ok: false, error: "Unknown fiscal period." };
  }
  const weeks = weeksOfPeriod(period);

  db.transaction((tx) => {
    tx.update(timesheetTable)
      .set({
        state: sql`CASE WHEN ${timesheetTable.approvedAt} IS NOT NULL THEN 'approved' WHEN ${timesheetTable.submittedAt} IS NOT NULL THEN 'submitted' ELSE 'in_progress' END`,
      })
      .where(
        and(
          inArray(timesheetTable.weekStartDate, weeks),
          eq(timesheetTable.state, "locked"),
        ),
      )
      .run();

    tx.delete(periodCloseTable).where(eq(periodCloseTable.id, close.id)).run();

    // DA-009: reopening a finalized period (period unlock) — atomically
    // audited so the unlock is always traceable.
    recordAudit(tx, {
      actorId: sessionUser.id,
      action: "close_reopen",
      entityType: "period",
      entityId: periodEntityId(fiscalYear, periodNumber),
      oldValue: "locked",
      newValue: "reopened",
    });
  });

  revalidateClosePaths();
  return { ok: true };
}
