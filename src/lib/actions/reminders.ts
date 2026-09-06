"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { reminderLog as reminderLogTable } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireRole } from "@/lib/permissions";
import { getOutstandingReminders } from "@/lib/reminders";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface ReminderTarget {
  userId: string;
  weekStartDate: string;
}

function revalidateReminderPaths() {
  revalidatePath("/reminders");
  revalidatePath("/");
}

// TS-019/020: ad-hoc in-app reminder trigger (no SMTP). Each send writes one
// reminder_log row; re-reminding is allowed and every send is recorded —
// idempotence comes from the audit/history trail, not from dedupe.
//
// targets = "all" recomputes the outstanding list server-side; an explicit
// pair list is validated against the same list so stale client selections
// (partner submitted in the meantime) are skipped instead of recorded.
export async function sendReminders(
  targets: "all" | ReminderTarget[],
  note?: string,
): Promise<ActionResult & { sent: number; skipped: number }> {
  const viewer = await requireRole(["admin"]);

  const outstanding = await getOutstandingReminders();
  const outstandingKeys = new Set(
    outstanding.map((r) => `${r.userId}|${r.weekStartDate}`),
  );

  let pending: ReminderTarget[];
  let skipped: number;
  if (targets === "all") {
    pending = outstanding.map((r) => ({
      userId: r.userId,
      weekStartDate: r.weekStartDate,
    }));
    skipped = 0;
  } else {
    const deduped = new Map(
      targets.map((t) => [`${t.userId}|${t.weekStartDate}`, t]),
    );
    pending = [...deduped.values()].filter((t) =>
      outstandingKeys.has(`${t.userId}|${t.weekStartDate}`),
    );
    skipped = deduped.size - pending.length;
  }

  if (pending.length === 0) {
    return {
      ok: true,
      sent: 0,
      skipped,
      error: skipped > 0 ? "Selected weeks are no longer outstanding." : undefined,
    };
  }

  const trimmedNote = note?.trim() || null;
  const batchId = crypto.randomUUID();

  // Sync callback + .run(): better-sqlite3 transactions reject promise-
  // returning callbacks, so all statements execute synchronously (same
  // pattern as approvals/close actions).
  db.transaction((tx) => {
    for (const target of pending) {
      tx.insert(reminderLogTable)
        .values({
          id: crypto.randomUUID(),
          userId: target.userId,
          weekStartDate: target.weekStartDate,
          remindedBy: viewer.id,
          remindedAt: new Date(),
          note: trimmedNote,
        })
        .run();
    }

    // DA-009: the whole send is one compliance event, atomically audited.
    recordAudit(tx, {
      actorId: viewer.id,
      action: "reminder_send",
      entityType: "reminder",
      entityId: batchId,
      newValue: `count=${pending.length}`,
      reason: trimmedNote,
    });
  });

  revalidateReminderPaths();
  return { ok: true, sent: pending.length, skipped };
}
