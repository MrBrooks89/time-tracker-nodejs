"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { appSetting } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireRole } from "@/lib/permissions";
import { validateSettings, type SettingKey } from "@/lib/settings";

export interface UpdateSettingsResult {
  ok: boolean;
  error?: string;
  /** Field-level validation errors keyed by setting key. */
  errors?: Partial<Record<SettingKey, string>>;
}

/**
 * Upserts admin-configurable settings (NF-012). Generic on purpose: the
 * /settings form submits every key, while the /reminders template editor
 * submits only the reminder templates — both write the same app_setting rows.
 * Values are validated with the pure validateSettings layer before any write;
 * each changed key is audit-logged (old → new) atomically with its upsert.
 */
export async function updateSettings(
  input: Partial<Record<SettingKey, string>>,
): Promise<UpdateSettingsResult> {
  const user = await requireRole(["admin"]);

  // validateSettings ignores unknown keys, so a malformed client cannot
  // invent new settings; absent keys leave the stored value untouched.
  const { ok, errors, parsed } = validateSettings(input);
  if (!ok) {
    return { ok: false, errors };
  }

  const keys = Object.keys(parsed) as SettingKey[];
  if (keys.length === 0) {
    return { ok: false, error: "No settings to update." };
  }

  // Old values for the audit trail (null = previously unset, default in use).
  const currentRows = await db
    .select({ key: appSetting.key, value: appSetting.value })
    .from(appSetting)
    .where(inArray(appSetting.key, keys));
  const currentValueByKey = new Map(
    currentRows.map((row) => [row.key, row.value]),
  );

  const changes = keys.flatMap((key) => {
    const newValue = parsed[key];
    if (newValue === undefined) return [];
    const oldValue = currentValueByKey.get(key) ?? null;
    // Unchanged values are skipped — no write, no audit noise.
    return newValue === oldValue ? [] : [{ key, oldValue, newValue }];
  });
  if (changes.length === 0) {
    return { ok: true };
  }

  const now = new Date();

  // Sync callback + .run(): better-sqlite3 transactions reject promise-
  // returning callbacks, so the upserts and audit rows run synchronously.
  db.transaction((tx) => {
    for (const change of changes) {
      tx.insert(appSetting)
        .values({
          key: change.key,
          value: change.newValue,
          updatedBy: user.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: appSetting.key,
          set: { value: change.newValue, updatedBy: user.id, updatedAt: now },
        })
        .run();

      recordAudit(tx, {
        actorId: user.id,
        action: "settings_update",
        entityType: "app_setting",
        entityId: change.key,
        field: change.key,
        oldValue: change.oldValue,
        newValue: change.newValue,
      });
    }
  });

  // Affected surfaces: the editor itself, entry validation (/week), the
  // close console + exception report (/close), and the reminder surfaces.
  revalidatePath("/settings");
  revalidatePath("/week");
  revalidatePath("/close");
  revalidatePath("/reminders");
  return { ok: true };
}
