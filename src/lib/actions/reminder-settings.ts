"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { appSetting as appSettingTable } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireRole } from "@/lib/permissions";
import { parseSetting, type SettingKey } from "@/lib/settings";
import { SETTING_KEYS } from "@/lib/settings-db";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// Minimal reminder-template editor action (D5/D7). The full /settings admin
// surface (all keys + audit) is owned by the settings workstream; this action
// only covers the two reminder template keys the /reminders page edits, and
// reuses the exact same Phase B validation (parseSetting) so a template that
// passes here also passes there. If a shared settings action appears later,
// this module can be retired in its favor.
export interface ReminderTemplatesInput {
  reminderSubject: string;
  reminderBody: string;
}

/**
 * Upserts the reminder subject/body templates. Values are validated with the
 * shared Phase B parseSetting (required placeholders, non-empty) before any
 * write; one bad template rejects the whole submission. Each change is
 * audited (DA-009) and the reminders surface is revalidated.
 */
export async function updateReminderTemplates(
  input: ReminderTemplatesInput,
): Promise<ActionResult> {
  const viewer = await requireRole(["admin"]);

  const values: Array<{ key: SettingKey; value: string }> = [];
  const inputs: Array<[SettingKey, string]> = [
    [SETTING_KEYS.reminderSubject, input.reminderSubject],
    [SETTING_KEYS.reminderBody, input.reminderBody],
  ];
  for (const [key, raw] of inputs) {
    const parsed = parseSetting(key, raw);
    if (!parsed.ok || parsed.value === null) {
      return { ok: false, error: parsed.error ?? "Invalid template." };
    }
    values.push({ key, value: parsed.value });
  }

  const now = new Date();

  // Sync callback + .run(): better-sqlite3 transactions reject promise-
  // returning callbacks (same pattern as approvals/close actions).
  db.transaction((tx) => {
    for (const { key, value } of values) {
      tx.insert(appSettingTable)
        .values({
          key,
          value,
          updatedBy: viewer.id,
          updatedAt: now,
        })
        // app_setting.key is the primary key — upsert keeps the editor
        // idempotent (re-saving an unchanged template rewrites the row).
        .onConflictDoUpdate({
          target: appSettingTable.key,
          set: { value, updatedBy: viewer.id, updatedAt: now },
        })
        .run();
    }

    // DA-009: template changes alter outgoing compliance email copy —
    // atomically audited with the writes.
    recordAudit(tx, {
      actorId: viewer.id,
      action: "reminder_template_update",
      entityType: "setting",
      entityId: SETTING_KEYS.reminderSubject,
      newValue: `subject=${input.reminderSubject.length}ch body=${input.reminderBody.length}ch`,
    });
  });

  revalidatePath("/reminders");
  revalidatePath("/");
  return { ok: true };
}
