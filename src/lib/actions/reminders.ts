"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { reminderLog as reminderLogTable } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { buildReminderEmail, renderTemplate } from "@/lib/email";
import { isMailConfigured, sendMail } from "@/lib/mailer";
import { requireRole } from "@/lib/permissions";
import { getOutstandingReminders } from "@/lib/reminders";
import { getSettings } from "@/lib/settings-db";

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

// TS-019/020: ad-hoc reminder trigger (D5). When SMTP is configured each
// outstanding week gets a rendered email (admin-editable templates from
// settings); unconfigured SMTP stays log-only — rows recorded as
// would_send, nothing dispatched. Re-reminding is allowed and every send is
// recorded — idempotence comes from the audit/history trail, not dedupe.
//
// targets = "all" recomputes the outstanding list server-side; an explicit
// pair list is validated against the same list so stale client selections
// (partner submitted in the meantime) are skipped instead of recorded.
export async function sendReminders(
  targets: "all" | ReminderTarget[],
  note?: string,
): Promise<ActionResult & { sent: number; skipped: number; failed: number }> {
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
      failed: 0,
      error: skipped > 0 ? "Selected weeks are no longer outstanding." : undefined,
    };
  }

  const trimmedNote = note?.trim() || null;
  const batchId = crypto.randomUUID();

  const settings = await getSettings();
  const configured = isMailConfigured();
  const channel: "email" | "in_app" = configured ? "email" : "in_app";
  const rowByKey = new Map(
    outstanding.map((r) => [`${r.userId}|${r.weekStartDate}`, r]),
  );

  // Send phase (async, outside the sync transaction): one email per
  // outstanding week. A transport failure records that row as "failed" and
  // never aborts the batch.
  const outcomes: Array<{
    target: ReminderTarget;
    recipient: string;
    status: "sent" | "would_send" | "failed";
  }> = [];
  for (const target of pending) {
    const row = rowByKey.get(`${target.userId}|${target.weekStartDate}`);
    if (!row) continue;
    let status: "sent" | "would_send" | "failed";
    if (configured) {
      const email = buildReminderEmail(
        { subject: settings.reminderSubject, body: settings.reminderBody },
        { partner: row.name, weekStartDate: row.weekStartDate, deadline: row.deadline },
      );
      const result = await sendMail({
        to: row.email,
        subject: renderTemplate(email.subject, { hours: row.expectedHours }),
        body: renderTemplate(email.body, { hours: row.expectedHours }),
      });
      status = result.status;
    } else {
      status = "would_send";
    }
    outcomes.push({ target, recipient: row.email, status });
  }

  const failed = outcomes.filter((o) => o.status === "failed").length;

  // Sync callback + .run(): better-sqlite3 transactions reject promise-
  // returning callbacks, so all statements execute synchronously (same
  // pattern as approvals/close actions).
  db.transaction((tx) => {
    for (const outcome of outcomes) {
      tx.insert(reminderLogTable)
        .values({
          id: crypto.randomUUID(),
          userId: outcome.target.userId,
          weekStartDate: outcome.target.weekStartDate,
          remindedBy: viewer.id,
          remindedAt: new Date(),
          note: trimmedNote,
          channel,
          status: outcome.status,
          recipient: outcome.recipient,
          trigger: "manual",
        })
        .run();
    }

    // DA-009: the whole send is one compliance event, atomically audited.
    recordAudit(tx, {
      actorId: viewer.id,
      action: "reminder_send",
      entityType: "reminder",
      entityId: batchId,
      newValue: `count=${outcomes.length} channel=${channel}`,
      reason: trimmedNote,
    });
  });

  revalidateReminderPaths();
  return {
    ok: true,
    sent: outcomes.length,
    skipped,
    failed,
    error:
      failed > 0
        ? `${failed} reminder${failed === 1 ? "" : "s"} failed to send — see the history table.`
        : undefined,
  };
}
