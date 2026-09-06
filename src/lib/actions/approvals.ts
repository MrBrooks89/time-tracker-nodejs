"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  timesheet as timesheetTable,
  timesheetDecision as decisionTable,
  user as userTable,
} from "@/db/schema";
import { canApprove, nextStateOnApprove, nextStateOnReject } from "@/lib/approval";
import { requireUser } from "@/lib/session";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function revalidateApprovalPaths() {
  revalidatePath("/approvals");
  revalidatePath("/week");
  revalidatePath("/");
}

// Shared guard for both decisions: loads the target user + sheet and runs the
// Phase B canApprove() rule with real values (D2 self-approval block, D3
// admin-owns-unmanaged/self-managed). Returns the sheet id on success.
async function loadApprovableSheet(
  viewer: { id: string; role: "admin" | "manager" | "employee" },
  userId: string,
  weekStartDate: string,
): Promise<{ sheetId: string } | { error: string }> {
  const [target] = await db
    .select({ id: userTable.id, isActive: userTable.isActive, managerId: userTable.managerId })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!target) {
    return { error: "Partner not found." };
  }
  if (!target.isActive) {
    return { error: "That partner's account is not active." };
  }

  const [sheet] = await db
    .select({ id: timesheetTable.id, state: timesheetTable.state })
    .from(timesheetTable)
    .where(
      and(
        eq(timesheetTable.userId, userId),
        eq(timesheetTable.weekStartDate, weekStartDate),
      ),
    )
    .limit(1);
  if (!sheet) {
    return { error: "No timesheet exists for that week." };
  }
  if (sheet.state !== "submitted") {
    return { error: "Only submitted timesheets can be decided." };
  }

  const allowed = canApprove(
    sheet.state,
    viewer.role,
    viewer.id,
    userId,
    target.managerId,
  );
  if (!allowed) {
    return { error: "You are not the approver for this timesheet." };
  }

  return { sheetId: sheet.id };
}

export async function approveTimesheet(
  userId: string,
  weekStartDate: string,
): Promise<ActionResult> {
  const viewer = await requireUser();
  if (viewer.role !== "manager" && viewer.role !== "admin") {
    return { ok: false, error: "Only managers and admins can approve timesheets." };
  }

  const loaded = await loadApprovableSheet(viewer, userId, weekStartDate);
  if ("error" in loaded) {
    return { ok: false, error: loaded.error };
  }

  const approvedAt = new Date();
  // Sync callback + .run(): better-sqlite3 transactions reject promise-returning
  // callbacks, so all statements execute synchronously inside the tx.
  db.transaction((tx) => {
    tx
      .update(timesheetTable)
      .set({
        state: nextStateOnApprove(),
        approvedAt,
        approvedBy: viewer.id,
      })
      .where(eq(timesheetTable.id, loaded.sheetId))
      .run();

    tx
      .insert(decisionTable)
      .values({
        id: crypto.randomUUID(),
        timesheetId: loaded.sheetId,
        decision: "approve",
        decidedBy: viewer.id,
        note: null,
      })
      .run();
  });

  revalidateApprovalPaths();
  return { ok: true };
}

export async function rejectTimesheet(
  userId: string,
  weekStartDate: string,
  note: string,
): Promise<ActionResult> {
  const viewer = await requireUser();
  if (viewer.role !== "manager" && viewer.role !== "admin") {
    return { ok: false, error: "Only managers and admins can reject timesheets." };
  }

  const trimmed = note.trim();
  if (!trimmed) {
    return { ok: false, error: "A rejection note is required." };
  }

  const loaded = await loadApprovableSheet(viewer, userId, weekStartDate);
  if ("error" in loaded) {
    return { ok: false, error: loaded.error };
  }

  // D4: rejection returns the sheet to the partner. submittedAt stays as
  // evidence of the original submission.
  db.transaction((tx) => {
    tx
      .update(timesheetTable)
      .set({ state: nextStateOnReject() })
      .where(eq(timesheetTable.id, loaded.sheetId))
      .run();

    tx
      .insert(decisionTable)
      .values({
        id: crypto.randomUUID(),
        timesheetId: loaded.sheetId,
        decision: "reject",
        decidedBy: viewer.id,
        note: trimmed,
      })
      .run();
  });

  revalidateApprovalPaths();
  return { ok: true };
}
