"use server";

import { and, between, count, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  fiscalPeriod as fiscalPeriodTable,
  holiday as holidayTable,
  periodClose as periodCloseTable,
  timesheet as timesheetTable,
} from "@/db/schema";
import { requireRole } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { addDays, generateFiscalYearPeriods, isWeekStart } from "@/lib/fiscal";
import { syncPeriodsFromDb } from "@/lib/fiscal-db";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict YYYY-MM-DD calendar-date check (rejects 2026-02-31 style strings). */
function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function revalidateCalendarPaths() {
  revalidatePath("/calendar");
  revalidatePath("/");
  revalidatePath("/week");
  revalidatePath("/approvals");
  revalidatePath("/close");
}

// ---------------------------------------------------------------------------
// Holidays (FC-003): add / update / remove. observed_date is unique in the
// schema; duplicates are caught up front so the admin gets a friendly error.
// Every mutation writes an audit_log row in the same transaction.
// ---------------------------------------------------------------------------

export async function addHoliday(
  name: string,
  observedDate: string,
): Promise<ActionResult> {
  const currentUser = await requireRole(["admin"]);

  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Holiday name is required." };
  }
  if (!isValidDate(observedDate)) {
    return { ok: false, error: "Enter a valid observed date (YYYY-MM-DD)." };
  }

  const [existing] = await db
    .select({ id: holidayTable.id })
    .from(holidayTable)
    .where(eq(holidayTable.observedDate, observedDate))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      error: "A holiday is already observed on that date.",
    };
  }

  const holidayId = crypto.randomUUID();
  try {
    db.transaction((tx) => {
      tx.insert(holidayTable)
        .values({ id: holidayId, name: trimmedName, observedDate })
        .run();
      recordAudit(tx, {
        actorId: currentUser.id,
        action: "holiday_add",
        entityType: "holiday",
        entityId: holidayId,
        newValue: JSON.stringify({ name: trimmedName, observedDate }),
      });
    });
  } catch {
    // Unique index raced a concurrent insert — same friendly message.
    return { ok: false, error: "A holiday is already observed on that date." };
  }

  revalidateCalendarPaths();
  return { ok: true };
}

export async function updateHoliday(
  id: string,
  name: string,
  observedDate: string,
): Promise<ActionResult> {
  const currentUser = await requireRole(["admin"]);

  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Holiday name is required." };
  }
  if (!isValidDate(observedDate)) {
    return { ok: false, error: "Enter a valid observed date (YYYY-MM-DD)." };
  }

  const [target] = await db
    .select()
    .from(holidayTable)
    .where(eq(holidayTable.id, id))
    .limit(1);
  if (!target) {
    return { ok: false, error: "Holiday not found." };
  }

  const [duplicate] = await db
    .select({ id: holidayTable.id })
    .from(holidayTable)
    .where(
      and(
        eq(holidayTable.observedDate, observedDate),
        ne(holidayTable.id, id),
      ),
    )
    .limit(1);
  if (duplicate) {
    return {
      ok: false,
      error: "A holiday is already observed on that date.",
    };
  }

  try {
    db.transaction((tx) => {
      tx.update(holidayTable)
        .set({ name: trimmedName, observedDate })
        .where(eq(holidayTable.id, id))
        .run();
      recordAudit(tx, {
        actorId: currentUser.id,
        action: "holiday_update",
        entityType: "holiday",
        entityId: id,
        oldValue: JSON.stringify({
          name: target.name,
          observedDate: target.observedDate,
        }),
        newValue: JSON.stringify({ name: trimmedName, observedDate }),
      });
    });
  } catch {
    return { ok: false, error: "A holiday is already observed on that date." };
  }

  revalidateCalendarPaths();
  return { ok: true };
}

export async function removeHoliday(id: string): Promise<ActionResult> {
  const currentUser = await requireRole(["admin"]);

  const [target] = await db
    .select()
    .from(holidayTable)
    .where(eq(holidayTable.id, id))
    .limit(1);
  if (!target) {
    return { ok: false, error: "Holiday not found." };
  }

  db.transaction((tx) => {
    tx.delete(holidayTable).where(eq(holidayTable.id, id)).run();
    recordAudit(tx, {
      actorId: currentUser.id,
      action: "holiday_remove",
      entityType: "holiday",
      entityId: id,
      oldValue: JSON.stringify({
        name: target.name,
        observedDate: target.observedDate,
      }),
    });
  });

  revalidateCalendarPaths();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fiscal periods (FC-008): generate a future year's 12 periods reusing
// fiscal.ts's 4-4-5 generator, plus guarded deletion.
//
// Delete-safety rule (documented decision): a single fiscal period may be
// deleted only when BOTH hold —
//   1. no timesheet's week start date falls within the period's date range
//      (partners have never filed against it), and
//   2. no period_close row exists for it (the close cycle never touched it).
// This is per-period rather than per-year: it is the simplest check that
// still guarantees deleting a period can never orphan filed time or close
// history.
// ---------------------------------------------------------------------------

export async function generateFiscalYear(
  year: number,
  firstPeriodStart: string,
): Promise<ActionResult> {
  const currentUser = await requireRole(["admin"]);

  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    return { ok: false, error: "Enter a valid fiscal year (e.g. 2028)." };
  }
  if (!isValidDate(firstPeriodStart)) {
    return {
      ok: false,
      error: "Enter a valid first period start date (YYYY-MM-DD).",
    };
  }
  if (!isWeekStart(firstPeriodStart)) {
    return {
      ok: false,
      error:
        "First period start must be a Wednesday — fiscal weeks run Wednesday to Tuesday.",
    };
  }

  const existingPeriods = await db
    .select()
    .from(fiscalPeriodTable)
    .orderBy(
      fiscalPeriodTable.fiscalYear,
      fiscalPeriodTable.periodNumber,
    );

  if (existingPeriods.some((p) => p.fiscalYear === year)) {
    return {
      ok: false,
      error: `FY${year} periods already exist — adjust or delete individual periods instead.`,
    };
  }

  // Enforce ordered generation so no fiscal year is left unpopulated.
  const maxExistingYear = existingPeriods.reduce(
    (max, p) => Math.max(max, p.fiscalYear),
    0,
  );
  if (maxExistingYear > 0 && year !== maxExistingYear + 1) {
    return {
      ok: false,
      error: `Generate fiscal years in order — the next year to generate is FY${maxExistingYear + 1}.`,
    };
  }

  // Continuity: a generated year must start the day after the previous year
  // ends (fiscal years are exactly 52 weeks). This also guarantees no overlap.
  const previousYearPeriods = existingPeriods.filter(
    (p) => p.fiscalYear === year - 1,
  );
  if (previousYearPeriods.length > 0) {
    const previousEnd = previousYearPeriods.reduce(
      (max, p) => (p.endDate > max ? p.endDate : max),
      previousYearPeriods[0].endDate,
    );
    const expectedStart = addDays(previousEnd, 1);
    if (firstPeriodStart !== expectedStart) {
      return {
        ok: false,
        error: `For continuity, FY${year} must start the day after FY${year - 1} ends (${expectedStart}).`,
      };
    }
  }

  const newPeriods = generateFiscalYearPeriods(year, firstPeriodStart);

  // Belt-and-braces overlap check against every existing period (any year).
  for (const existing of existingPeriods) {
    const overlap =
      newPeriods[0].startDate <= existing.endDate &&
      newPeriods[11].endDate >= existing.startDate;
    if (overlap) {
      return {
        ok: false,
        error: `FY${year} would overlap the existing periods of FY${existing.fiscalYear}.`,
      };
    }
  }

  try {
    db.transaction((tx) => {
      for (const period of newPeriods) {
        tx.insert(fiscalPeriodTable)
          .values({
            id: crypto.randomUUID(),
            fiscalYear: period.fiscalYear,
            quarter: period.quarter,
            periodNumber: period.periodNumber,
            startDate: period.startDate,
            endDate: period.endDate,
            weekCount: period.weekCount,
          })
          .run();
      }
      recordAudit(tx, {
        actorId: currentUser.id,
        action: "fiscal_year_generate",
        entityType: "fiscal_period",
        entityId: `FY${year}`,
        newValue: JSON.stringify({
          fiscalYear: year,
          periods: 12,
          startDate: firstPeriodStart,
        }),
      });
    });
  } catch {
    return {
      ok: false,
      error: `Could not generate FY${year} — a period for this year may already exist.`,
    };
  }

  // Register the new periods so week lookups resolve them immediately.
  await syncPeriodsFromDb();

  revalidateCalendarPaths();
  return { ok: true };
}

export async function deleteFiscalPeriod(id: string): Promise<ActionResult> {
  const currentUser = await requireRole(["admin"]);

  const [period] = await db
    .select()
    .from(fiscalPeriodTable)
    .where(eq(fiscalPeriodTable.id, id))
    .limit(1);
  if (!period) {
    return { ok: false, error: "Fiscal period not found." };
  }

  // Safety rule 1: never delete a period partners have filed time against.
  const [filed] = await db
    .select({ value: count() })
    .from(timesheetTable)
    .where(
      between(
        timesheetTable.weekStartDate,
        period.startDate,
        period.endDate,
      ),
    );
  if (Number(filed?.value ?? 0) > 0) {
    return {
      ok: false,
      error:
        "Partners already have timesheets in this period, so it can't be deleted.",
    };
  }

  // Safety rule 2: never delete a period the close cycle has touched.
  const [closed] = await db
    .select({ value: count() })
    .from(periodCloseTable)
    .where(
      and(
        eq(periodCloseTable.fiscalYear, period.fiscalYear),
        eq(periodCloseTable.periodNumber, period.periodNumber),
      ),
    );
  if (Number(closed?.value ?? 0) > 0) {
    return {
      ok: false,
      error:
        "This period has close records and can't be deleted.",
    };
  }

  db.transaction((tx) => {
    tx.delete(fiscalPeriodTable)
      .where(eq(fiscalPeriodTable.id, id))
      .run();
    recordAudit(tx, {
      actorId: currentUser.id,
      action: "fiscal_period_delete",
      entityType: "fiscal_period",
      entityId: id,
      oldValue: JSON.stringify({
        fiscalYear: period.fiscalYear,
        periodNumber: period.periodNumber,
        startDate: period.startDate,
        endDate: period.endDate,
      }),
    });
  });

  revalidateCalendarPaths();
  return { ok: true };
}
