"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  classificationRule as ruleTable,
  correctionLog as correctionLogTable,
  favorite as favoriteTable,
  periodClose as periodCloseTable,
  project as projectTable,
  projectAssignment as assignmentTable,
  taskCode as taskCodeTable,
  timeEntry as timeEntryTable,
  timesheet as timesheetTable,
  user as userTable,
} from "@/db/schema";
import { requireUser, type Role } from "@/lib/session";
import { isReadOnlyRole } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { MAX_HOURS_PER_DAY } from "@/lib/config";
import { classifyEntry, classifyNonProjectEntry, type RuleInfo } from "@/lib/classification";
import { buildCorrectionValues, shouldMarkRestated, validateCorrection } from "@/lib/corrections";
import { addWeeks, findWeek, isWeekStart, weekDates, weekEnterable } from "@/lib/fiscal";
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
  // TS-021/022 delegated entry: admins may act on another partner's week.
  // Ignored/unused for non-admins — never trusted from the client.
  targetUserId?: string | null;
}

// Resolves who the timesheet action applies to. Admins may act on any active
// partner (delegated entry); every other role always acts on themselves and
// any attempt to target another user is rejected server-side.
function resolveOwner(
  sessionUser: { id: string; role: Role },
  targetUserId: string | null | undefined,
): { ownerUserId: string; delegated: boolean; error?: string } {
  if (!targetUserId || targetUserId === sessionUser.id) {
    return { ownerUserId: sessionUser.id, delegated: false };
  }
  if (sessionUser.role !== "admin") {
    return {
      ownerUserId: sessionUser.id,
      delegated: false,
      error: "Not permitted: only admins may edit another partner's timesheet.",
    };
  }
  return { ownerUserId: targetUserId, delegated: true };
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

  // Section 1.4: read-only roles (finance_viewer, leadership) never mutate
  // timesheets — the /week page also redirects them, this re-verifies.
  if (isReadOnlyRole(sessionUser.role)) {
    return { ok: false, error: "Not permitted: your role is read-only." };
  }

  const { weekStartDate, rows } = input;

  const owner = resolveOwner(sessionUser, input.targetUserId);
  if (owner.error) return { ok: false, error: owner.error };

  const [userRow] = await db
    .select({ isActive: userTable.isActive })
    .from(userTable)
    .where(eq(userTable.id, owner.ownerUserId))
    .limit(1);
  if (!userRow?.isActive) {
    return {
      ok: false,
      error: owner.delegated
        ? "That partner's account is not active."
        : "Your account is not active.",
    };
  }

  const weekError = await validateInputWeek(weekStartDate);
  if (weekError) return weekError;

  const sheet = await getOrCreateSheet(owner.ownerUserId, weekStartDate);
  if (!sheet) return { ok: false, error: "Could not open timesheet." };
  if (sheet.state === "locked") {
    return { ok: false, error: "This week is locked." };
  }

  // DA-009: single summary audit row per save (never one per cell — the
  // save replaces the whole sheet, so entry counts + hours tell the story).
  const previousEntries = await db
    .select({ hours: timeEntryTable.hours })
    .from(timeEntryTable)
    .where(eq(timeEntryTable.timesheetId, sheet.id));

  const validDates = new Set(weekDates(weekStartDate));

  const assignmentRows = await db
    .select({ projectId: assignmentTable.projectId })
    .from(assignmentTable)
    .innerJoin(projectTable, eq(assignmentTable.projectId, projectTable.id))
    .where(
      and(
        eq(assignmentTable.userId, owner.ownerUserId),
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
    enteredBy: string;
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
        return {
          ok: false,
          error: owner.delegated
            ? "That partner is not assigned to that project."
            : "You are not assigned to that project.",
        };
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
        // TS-021/022: track the actor — the admin id on delegated edits,
        // the partner's own id for self edits.
        enteredBy: sessionUser.id,
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
        // D4: editing an approved sheet reverts it to draft — approval only
        // gates the lock step, so the prior approval is cleared.
        approvedAt: null,
        approvedBy: null,
      })
      .where(eq(timesheetTable.id, sheet.id))
      .run();

    // DA-009: one compact summary row per save — old/new entry counts and
    // total hours, atomically with the save itself.
    recordAudit(tx, {
      actorId: sessionUser.id,
      action: "entry_save",
      entityType: "timesheet",
      entityId: sheet.id,
      oldValue: JSON.stringify({
        entries: previousEntries.length,
        hours: previousEntries.reduce((sum, e) => sum + e.hours, 0),
      }),
      newValue: JSON.stringify({
        entries: inserts.length,
        hours: inserts.reduce((sum, e) => sum + e.hours, 0),
        week_start_date: weekStartDate,
      }),
    });

    // TS-021/022: delegation events go to the append-only audit trail,
    // atomically with the save itself.
    if (owner.delegated) {
      recordAudit(tx, {
        actorId: sessionUser.id,
        action: "delegated_save",
        entityType: "timesheet",
        entityId: sheet.id,
        newValue: `week_start_date=${weekStartDate}`,
      });
    }
  });

  revalidateWeekPaths();
  return { ok: true };
}

export async function submitWeek(
  weekStartDate: string,
  targetUserId?: string | null,
): Promise<ActionResult> {
  const sessionUser = await requireUser();

  // Section 1.4: read-only roles never submit timesheets.
  if (isReadOnlyRole(sessionUser.role)) {
    return { ok: false, error: "Not permitted: your role is read-only." };
  }

  const owner = resolveOwner(sessionUser, targetUserId);
  if (owner.error) return { ok: false, error: owner.error };

  const weekError = await validateInputWeek(weekStartDate);
  if (weekError) return weekError;

  // Read-only lookup: submitting must never create a phantom in_progress
  // sheet for an empty week (compliance status stays not_started).
  const [sheet] = await db
    .select({ id: timesheetTable.id, state: timesheetTable.state })
    .from(timesheetTable)
    .where(
      and(
        eq(timesheetTable.userId, owner.ownerUserId),
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

  // Sync callback + .run(): better-sqlite3 transactions reject
  // promise-returning callbacks, so the update and audit write execute
  // synchronously inside the tx for atomicity.
  db.transaction((tx) => {
    tx
      .update(timesheetTable)
      .set({
        state: "submitted",
        submittedAt: new Date(),
        // D4: resubmission restarts the approval cycle — a prior approval no
        // longer applies to the edited entries.
        approvedAt: null,
        approvedBy: null,
      })
      .where(eq(timesheetTable.id, sheet.id))
      .run();

    // DA-009: every submission lands in the audit trail, atomically.
    recordAudit(tx, {
      actorId: sessionUser.id,
      action: "submit",
      entityType: "timesheet",
      entityId: sheet.id,
      newValue: `week_start_date=${weekStartDate}`,
    });

    if (owner.delegated) {
      recordAudit(tx, {
        actorId: sessionUser.id,
        action: "delegated_submit",
        entityType: "timesheet",
        entityId: sheet.id,
        newValue: `week_start_date=${weekStartDate}`,
      });
    }
  });

  revalidateWeekPaths();
  return { ok: true };
}

export async function copyPriorWeek(
  weekStartDate: string,
  targetUserId?: string | null,
): Promise<ActionResult> {
  const sessionUser = await requireUser();

  // Section 1.4: read-only roles never mutate timesheets.
  if (isReadOnlyRole(sessionUser.role)) {
    return { ok: false, error: "Not permitted: your role is read-only." };
  }

  const owner = resolveOwner(sessionUser, targetUserId);
  if (owner.error) return { ok: false, error: owner.error };

  const weekError = await validateInputWeek(weekStartDate);
  if (weekError) return weekError;

  const sheet = await getOrCreateSheet(owner.ownerUserId, weekStartDate);
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
        eq(timesheetTable.userId, owner.ownerUserId),
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
        eq(assignmentTable.userId, owner.ownerUserId),
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
      // TS-021/022: the copy actor — admin id on delegated copies.
      enteredBy: sessionUser.id,
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
      .set({
        state: "in_progress",
        submittedAt: null,
        // D4: copying into an approved sheet reverts it to draft.
        approvedAt: null,
        approvedBy: null,
      })
      .where(eq(timesheetTable.id, sheet.id))
      .run();

    if (owner.delegated) {
      recordAudit(tx, {
        actorId: sessionUser.id,
        action: "delegated_save",
        entityType: "timesheet",
        entityId: sheet.id,
        newValue: `week_start_date=${weekStartDate}`,
        reason: "copy_prior_week",
      });
    }
  });

  revalidateWeekPaths();
  return { ok: true };
}

export interface CorrectionEntryInput {
  timeEntryId: string;
  hours: number;
  note?: string | null;
}

export interface CorrectLockedWeekInput {
  weekStartDate: string;
  // Mandatory compliance reason (TS-026) — blank/whitespace is rejected.
  reason: string;
  entries: CorrectionEntryInput[];
  // TS-028: admins may correct another partner's locked week. Ignored for
  // non-admins — never trusted from the client.
  targetUserId?: string | null;
}

// TS-028 + TS-026: the ONLY path that may modify entries inside a LOCKED
// week. saveWeek / submitWeek / copyPriorWeek keep rejecting locked sheets;
// this action requires an admin session, a mandatory reason, and writes a
// correction_log row plus an audit_log event for every corrected entry,
// atomically. The sheet itself stays locked — no state machine bypass.
export async function correctLockedWeek(
  input: CorrectLockedWeekInput,
): Promise<ActionResult> {
  const sessionUser = await requireUser();

  // Server-side permission check is authoritative: the UI hides the
  // correction affordance from non-admins, but the action re-verifies.
  if (sessionUser.role !== "admin") {
    return { ok: false, error: "Not permitted: corrections are admin-only." };
  }

  const owner = resolveOwner(sessionUser, input.targetUserId);
  if (owner.error) return { ok: false, error: owner.error };

  if (!isWeekStart(input.weekStartDate)) {
    return { ok: false, error: "Invalid week." };
  }

  const [sheet] = await db
    .select({ id: timesheetTable.id, state: timesheetTable.state })
    .from(timesheetTable)
    .where(
      and(
        eq(timesheetTable.userId, owner.ownerUserId),
        eq(timesheetTable.weekStartDate, input.weekStartDate),
      ),
    )
    .limit(1);
  if (!sheet) {
    return { ok: false, error: "No timesheet exists for that week." };
  }
  // Only locked sheets take corrections; every other state keeps its normal
  // editing path, so approval/close semantics stay untouched.
  if (sheet.state !== "locked") {
    return { ok: false, error: "Only locked weeks can be corrected here." };
  }

  const reason = input.reason ?? "";
  const submitted = input.entries ?? [];
  if (submitted.length === 0) {
    return { ok: false, error: "No entries were submitted for correction." };
  }

  const weekEntries = await db
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.timesheetId, sheet.id));
  const entryById = new Map(weekEntries.map((e) => [e.id, e]));

  interface PendingCorrection {
    entryId: string;
    hours: number;
    note: string | null;
    originalValue: string;
    newValue: string;
    field: string;
  }
  const changes: PendingCorrection[] = [];

  for (const item of submitted) {
    const entry = entryById.get(item.timeEntryId);
    if (!entry) {
      return {
        ok: false,
        error: "That entry does not belong to this locked week.",
      };
    }
    const check = validateCorrection({ reason, hours: item.hours });
    if (!check.ok) return { ok: false, error: check.error };

    const values = buildCorrectionValues({
      originalHours: entry.hours,
      newHours: item.hours,
      originalNote: entry.note,
      newNote: item.note ?? null,
    });
    // Unchanged entries are skipped — only real changes are logged.
    if (!values.changed) continue;
    changes.push({
      entryId: entry.id,
      hours: item.hours,
      note: item.note ?? null,
      originalValue: values.originalValue,
      newValue: values.newValue,
      field: values.field,
    });
  }

  if (changes.length === 0) {
    return {
      ok: false,
      error: "No changes to apply — adjust hours or notes first.",
    };
  }

  const normalizedReason = reason.trim();
  const now = new Date();
  const period = findWeek(input.weekStartDate);

  // TS-029: read the close state up front so the restated-at decision is a
  // pure call. Finality mirrors the schema: closedAt null = close initiated
  // but not yet finalized (correction window), missing row = never initiated.
  const [closeRow] = period
    ? await db
        .select({ closedAt: periodCloseTable.closedAt })
        .from(periodCloseTable)
        .where(
          and(
            eq(periodCloseTable.fiscalYear, period.period.fiscalYear),
            eq(periodCloseTable.periodNumber, period.period.periodNumber),
          ),
        )
        .limit(1)
    : [];

  // Sync callback + .run(): better-sqlite3 transactions reject promise-
  // returning callbacks, so all statements execute synchronously.
  db.transaction((tx) => {
    for (const change of changes) {
      tx.update(timeEntryTable)
        .set({ hours: change.hours, note: change.note, updatedAt: now })
        .where(eq(timeEntryTable.id, change.entryId))
        .run();

      // TS-026: one correction_log row per corrected entry — who, when,
      // why, and the original → new values.
      tx.insert(correctionLogTable)
        .values({
          id: crypto.randomUUID(),
          timeEntryId: change.entryId,
          timesheetId: sheet.id,
          correctedBy: sessionUser.id,
          reason: normalizedReason,
          originalValue: change.originalValue,
          newValue: change.newValue,
          correctedAt: now,
        })
        .run();

      // DA-009: the same event lands in the append-only audit trail,
      // atomically with the correction itself.
      recordAudit(tx, {
        actorId: sessionUser.id,
        action: "correction",
        entityType: "time_entry",
        entityId: change.entryId,
        field: change.field,
        oldValue: change.originalValue,
        newValue: change.newValue,
        reason: normalizedReason,
      });
    }

    // TS-029: only corrections made AFTER the period was finalized restate
    // it — bump the timestamp on that week's period close row. While the
    // correction window is still open (closedAt null) or no close exists,
    // reports were never finalized, so there is nothing to restate.
    if (period && shouldMarkRestated(closeRow ?? null)) {
      tx.update(periodCloseTable)
        .set({ restatedAt: now })
        .where(
          and(
            eq(periodCloseTable.fiscalYear, period.period.fiscalYear),
            eq(periodCloseTable.periodNumber, period.period.periodNumber),
          ),
        )
        .run();
    }
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

  // Section 1.4: favorites are week-entry state — read-only roles skip them.
  if (isReadOnlyRole(sessionUser.role)) {
    return { ok: false, error: "Not permitted: your role is read-only." };
  }

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
  if (isReadOnlyRole(sessionUser.role)) {
    return { ok: false, error: "Not permitted: your role is read-only." };
  }
  await db
    .delete(favoriteTable)
    .where(and(eq(favoriteTable.id, id), eq(favoriteTable.userId, sessionUser.id)));
  revalidatePath("/week");
  return { ok: true };
}
