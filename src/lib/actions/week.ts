"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  classificationRule as ruleTable,
  favorite as favoriteTable,
  project as projectTable,
  projectAssignment as assignmentTable,
  taskCode as taskCodeTable,
  timeEntry as timeEntryTable,
  timesheet as timesheetTable,
  user as userTable,
} from "@/db/schema";
import { requirePeopleManager } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { MAX_HOURS_PER_DAY } from "@/lib/config";
import { classifyEntry, classifyNonProjectEntry, type RuleInfo } from "@/lib/classification";
import { addWeeks, isWeekStart, weekDates, weekEnterable } from "@/lib/fiscal";
import { isValidHoursIncrement } from "@/lib/entry-validation";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface SaveRow {
  projectId: string | null;
  taskCodeId: string | null;
  nonProjectCategoryId: string | null;
  isHandsOn: boolean;
  note: string | null;
  days: Record<string, number>;
}

export interface SaveWeekInput {
  weekStartDate: string;
  rows: SaveRow[];
}

function revalidateWeekPaths() {
  revalidatePath("/week");
  revalidatePath("/");
  revalidatePath("/reports");
}

async function loadRules(): Promise<RuleInfo[]> {
  const rules = await db.select().from(ruleTable);
  return rules.map((r) => ({
    taskCodeId: r.taskCodeId,
    classification: r.classification,
    effectiveFrom: r.effectiveFrom,
    notes: r.notes,
  }));
}

async function getOrCreateSheet(
  userId: string,
  weekStartDate: string,
): Promise<{ id: string; state: string } | null> {
  const [existing] = await db
    .select()
    .from(timesheetTable)
    .where(
      and(
        eq(timesheetTable.userId, userId),
        eq(timesheetTable.weekStartDate, weekStartDate),
      ),
    )
    .limit(1);
  if (existing) return { id: existing.id, state: existing.state };

  const id = crypto.randomUUID();
  await db.insert(timesheetTable).values({
    id,
    userId,
    weekStartDate,
    state: "in_progress",
  });
  return { id, state: "in_progress" };
}

async function validateInputWeek(
  weekStartDate: string,
): Promise<ActionResult | null> {
  if (!isWeekStart(weekStartDate)) {
    return { ok: false, error: "Invalid week." };
  }
  if (!weekEnterable(weekStartDate)) {
    return { ok: false, error: "This week isn't open for entry." };
  }
  return null;
}

export async function saveWeek(input: SaveWeekInput): Promise<ActionResult> {
  const sessionUser = await requireUser();
  const { weekStartDate, rows } = input;

  const [userRow] = await db
    .select({ isActive: userTable.isActive })
    .from(userTable)
    .where(eq(userTable.id, sessionUser.id))
    .limit(1);
  if (!userRow?.isActive) {
    return { ok: false, error: "Your account is not active." };
  }

  const weekError = await validateInputWeek(weekStartDate);
  if (weekError) return weekError;

  const sheet = await getOrCreateSheet(sessionUser.id, weekStartDate);
  if (!sheet) return { ok: false, error: "Could not open timesheet." };
  if (sheet.state === "locked") {
    return { ok: false, error: "This week is locked." };
  }

  const validDates = new Set(weekDates(weekStartDate));

  const assignmentRows = await db
    .select({ projectId: assignmentTable.projectId })
    .from(assignmentTable)
    .innerJoin(projectTable, eq(assignmentTable.projectId, projectTable.id))
    .where(
      and(
        eq(assignmentTable.userId, sessionUser.id),
        isNull(assignmentTable.removedAt),
        eq(projectTable.isActive, true),
      ),
    );
  const assignedProjectIds = new Set(assignmentRows.map((r) => r.projectId));

  const [rules, codes] = await Promise.all([
    loadRules(),
    db.select({ id: taskCodeTable.id, name: taskCodeTable.name }).from(taskCodeTable),
  ]);
  const codeNameById = new Map(codes.map((c) => [c.id, c.name]));

  const dayTotals: Record<string, number> = {};
  const inserts: Array<{
    entryDate: string;
    hours: number;
    projectId: string | null;
    taskCodeId: string | null;
    nonProjectCategoryId: string | null;
    isHandsOn: boolean;
    resolvedClassification: "capex" | "opex";
    note: string | null;
  }> = [];

  for (const row of rows) {
    const isProjectRow = row.taskCodeId !== null;
    const isCategoryRow = row.nonProjectCategoryId !== null;

    if (isProjectRow === isCategoryRow) {
      return {
        ok: false,
        error: "Each row needs a project task code or a non-project category.",
      };
    }

    const dayValues = Object.entries(row.days).filter(([date]) => validDates.has(date));
    const hasHours = dayValues.some(([, hours]) => hours > 0);
    if (!hasHours) continue;

    if (isProjectRow) {
      if (!row.projectId) {
        return { ok: false, error: "Select a project." };
      }
      if (!row.taskCodeId) {
        return { ok: false, error: "Select a task code." };
      }
      if (!assignedProjectIds.has(row.projectId)) {
        return { ok: false, error: "You are not assigned to that project." };
      }
    } else {
      if (row.projectId !== null) {
        return { ok: false, error: "Category rows cannot have a project." };
      }
    }

    for (const [date, hours] of dayValues) {
      if (!isValidHoursIncrement(hours)) {
        return {
          ok: false,
          error: `Hours must be in 0.25 increments on ${date}.`,
        };
      }
      if (hours < 0) {
        return { ok: false, error: "Hours must be zero or positive." };
      }
      if (hours > 0) {
        dayTotals[date] = (dayTotals[date] ?? 0) + hours;
      }
    }

    for (const [date, hours] of dayValues) {
      if (hours <= 0) continue;
      const resolved = isProjectRow && row.taskCodeId
        ? classifyEntry(
            row.taskCodeId,
            codeNameById.get(row.taskCodeId) ?? "",
            rules,
            date,
            row.isHandsOn,
          )
        : classifyNonProjectEntry();
      if (isProjectRow && resolved === null) {
        return { ok: false, error: "No classification rule for that task code." };
      }
      inserts.push({
        entryDate: date,
        hours,
        projectId: row.projectId,
        taskCodeId: row.taskCodeId,
        nonProjectCategoryId: row.nonProjectCategoryId,
        isHandsOn: row.isHandsOn,
        resolvedClassification: resolved ?? "opex",
        note: row.note,
      });
    }
  }

  for (const [date, total] of Object.entries(dayTotals)) {
    if (total > MAX_HOURS_PER_DAY) {
      return {
        ok: false,
        error: `${date} exceeds the ${MAX_HOURS_PER_DAY}h daily maximum.`,
      };
    }
  }

  // Sync callback + .run(): better-sqlite3 transactions reject promise-returning
  // callbacks, so all statements execute synchronously inside the tx.
  db.transaction((tx) => {
    tx.delete(timeEntryTable).where(eq(timeEntryTable.timesheetId, sheet.id)).run();

    if (inserts.length > 0) {
      tx.insert(timeEntryTable).values(
        inserts.map((entry) => ({
          id: crypto.randomUUID(),
          timesheetId: sheet.id,
          ...entry,
        })),
      ).run();
    }

    tx
      .update(timesheetTable)
      .set({
        state: "in_progress",
        submittedAt: null,
      })
      .where(eq(timesheetTable.id, sheet.id))
      .run();
  });

  revalidateWeekPaths();
  return { ok: true };
}

export async function submitWeek(weekStartDate: string): Promise<ActionResult> {
  const sessionUser = await requireUser();

  const weekError = await validateInputWeek(weekStartDate);
  if (weekError) return weekError;

  // Read-only lookup: submitting must never create a phantom in_progress
  // sheet for an empty week (compliance status stays not_started).
  const [sheet] = await db
    .select({ id: timesheetTable.id, state: timesheetTable.state })
    .from(timesheetTable)
    .where(
      and(
        eq(timesheetTable.userId, sessionUser.id),
        eq(timesheetTable.weekStartDate, weekStartDate),
      ),
    )
    .limit(1);
  if (!sheet) return { ok: false, error: "Add hours before submitting." };
  if (sheet.state === "locked") {
    return { ok: false, error: "This week is locked." };
  }

  const entries = await db
    .select({ hours: timeEntryTable.hours })
    .from(timeEntryTable)
    .where(eq(timeEntryTable.timesheetId, sheet.id));

  const total = entries.reduce((sum, e) => sum + e.hours, 0);
  if (total <= 0) {
    return { ok: false, error: "Add hours before submitting." };
  }

  await db
    .update(timesheetTable)
    .set({ state: "submitted", submittedAt: new Date() })
    .where(eq(timesheetTable.id, sheet.id));

  revalidateWeekPaths();
  return { ok: true };
}

export async function copyPriorWeek(weekStartDate: string): Promise<ActionResult> {
  const sessionUser = await requireUser();

  const weekError = await validateInputWeek(weekStartDate);
  if (weekError) return weekError;

  const sheet = await getOrCreateSheet(sessionUser.id, weekStartDate);
  if (!sheet) return { ok: false, error: "Could not open timesheet." };
  if (sheet.state === "locked") {
    return { ok: false, error: "This week is locked." };
  }

  const priorWeek = addWeeks(weekStartDate, -1);
  const [priorSheet] = await db
    .select()
    .from(timesheetTable)
    .where(
      and(
        eq(timesheetTable.userId, sessionUser.id),
        eq(timesheetTable.weekStartDate, priorWeek),
      ),
    )
    .limit(1);
  if (!priorSheet) {
    return { ok: false, error: "No entries in last week to copy." };
  }

  const priorEntries = await db
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.timesheetId, priorSheet.id));
  if (priorEntries.length === 0) {
    return { ok: false, error: "No entries in last week to copy." };
  }

  const assignmentRows = await db
    .select({ projectId: assignmentTable.projectId })
    .from(assignmentTable)
    .innerJoin(projectTable, eq(assignmentTable.projectId, projectTable.id))
    .where(
      and(
        eq(assignmentTable.userId, sessionUser.id),
        isNull(assignmentTable.removedAt),
        eq(projectTable.isActive, true),
      ),
    );
  const assignedProjectIds = new Set(assignmentRows.map((r) => r.projectId));

  const [rules, codes] = await Promise.all([
    loadRules(),
    db.select({ id: taskCodeTable.id, name: taskCodeTable.name }).from(taskCodeTable),
  ]);
  const codeNameById = new Map(codes.map((c) => [c.id, c.name]));

  const inserts: Array<typeof timeEntryTable.$inferInsert> = [];
  for (const entry of priorEntries) {
    if (entry.projectId && !assignedProjectIds.has(entry.projectId)) continue;

    const shiftedDate = shiftDate(entry.entryDate, 7);

    const resolved = entry.taskCodeId
      ? classifyEntry(
          entry.taskCodeId,
          codeNameById.get(entry.taskCodeId) ?? "",
          rules,
          shiftedDate,
          entry.isHandsOn,
        )
      : classifyNonProjectEntry();

    if (entry.taskCodeId && resolved === null) continue;

    inserts.push({
      id: crypto.randomUUID(),
      timesheetId: sheet.id,
      entryDate: shiftedDate,
      hours: entry.hours,
      projectId: entry.projectId,
      taskCodeId: entry.taskCodeId,
      nonProjectCategoryId: entry.nonProjectCategoryId,
      isHandsOn: entry.isHandsOn,
      resolvedClassification: resolved ?? "opex",
      note: entry.note,
    });
  }

  if (inserts.length === 0) {
    return {
      ok: false,
      error: "Nothing to copy — projects from last week are no longer assigned.",
    };
  }

  // Sync callback + .run(): better-sqlite3 transactions reject promise-returning
  // callbacks, so all statements execute synchronously inside the tx.
  db.transaction((tx) => {
    tx.delete(timeEntryTable).where(eq(timeEntryTable.timesheetId, sheet.id)).run();
    tx.insert(timeEntryTable).values(inserts).run();

    tx
      .update(timesheetTable)
      .set({ state: "in_progress", submittedAt: null })
      .where(eq(timesheetTable.id, sheet.id))
      .run();
  });

  revalidateWeekPaths();
  return { ok: true };
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export async function addFavorite(
  projectId: string,
  taskCodeId: string,
): Promise<ActionResult> {
  const sessionUser = await requireUser();

  const [assignment] = await db
    .select({ id: assignmentTable.id })
    .from(assignmentTable)
    .innerJoin(projectTable, eq(assignmentTable.projectId, projectTable.id))
    .where(
      and(
        eq(assignmentTable.userId, sessionUser.id),
        eq(assignmentTable.projectId, projectId),
        isNull(assignmentTable.removedAt),
        eq(projectTable.isActive, true),
      ),
    )
    .limit(1);
  if (!assignment) {
    return { ok: false, error: "You are not assigned to that project." };
  }

  try {
    await db.insert(favoriteTable).values({
      id: crypto.randomUUID(),
      userId: sessionUser.id,
      projectId,
      taskCodeId,
    });
  } catch {
    return { ok: true };
  }

  revalidatePath("/week");
  return { ok: true };
}

export async function removeFavorite(id: string): Promise<ActionResult> {
  const sessionUser = await requireUser();
  await db
    .delete(favoriteTable)
    .where(and(eq(favoriteTable.id, id), eq(favoriteTable.userId, sessionUser.id)));
  revalidatePath("/week");
  return { ok: true };
}

export async function simulateClose(weekStartDate: string): Promise<ActionResult> {
  await requirePeopleManager();
  if (!isWeekStart(weekStartDate)) {
    return { ok: false, error: "Invalid week." };
  }

  await db
    .update(timesheetTable)
    .set({ state: "locked" })
    .where(eq(timesheetTable.weekStartDate, weekStartDate));

  revalidateWeekPaths();
  return { ok: true };
}

export async function unlockWeek(weekStartDate: string): Promise<ActionResult> {
  await requirePeopleManager();

  // simulateClose locks every sheet in the week (including never-submitted
  // ones), so restore per-sheet state from evidence: submittedAt proves a real
  // submission; anything else was in_progress before the lock.
  await db
    .update(timesheetTable)
    .set({
      state: sql`CASE WHEN ${timesheetTable.submittedAt} IS NULL THEN 'in_progress' ELSE 'submitted' END`,
    })
    .where(
      and(
        eq(timesheetTable.weekStartDate, weekStartDate),
        eq(timesheetTable.state, "locked"),
      ),
    );

  revalidateWeekPaths();
  return { ok: true };
}
