// Thin typed reader for admin-configurable settings (NF-012). Single source
// of truth for keys, defaults, and parsing is the pure settings module
// (./settings.ts); this layer only reads app_setting rows, canonicalizes
// stored values through parseSetting (same rules as the write path), and
// falls back to defaults. The AppSettings shape is a stable contract consumed
// by week entry, close, reminders, and the AI helper — do not reshape it.
// Relative .ts imports: this module is also loaded outside Next (seed runs
// under node --experimental-strip-types, which cannot resolve the @/ alias).
import { db } from "../db/index.ts";
import { appSetting } from "../db/schema.ts";
import {
  SETTING_KEYS as SETTING_KEY_LIST,
  defaultSettings,
  parseSetting,
  type SettingKey,
} from "./settings.ts";

export type { SettingKey };

export interface AppSettings {
  maxHoursPerDay: number;
  correctionWindowDays: number;
  hoursTolerance: number;
  reminderSubject: string;
  reminderBody: string;
  aiModel: string;
}

/** camelCase field names for the snake_case setting keys — the view seed.ts
 * and the AppSettings shape address settings by. */
export type SettingField =
  | "maxHoursPerDay"
  | "correctionWindowDays"
  | "hoursTolerance"
  | "reminderSubject"
  | "reminderBody"
  | "aiModel";

const toCamelCase = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

// Derived from the SETTING_KEYS tuple so the key strings stay single-sourced
// in settings.ts (the cast bridges the runtime camelCase mapping to literal
// types; every tuple key maps to exactly one field above).
export const SETTING_KEYS = Object.fromEntries(
  SETTING_KEY_LIST.map((key) => [toCamelCase(key), key]),
) as Record<SettingField, SettingKey>;

// Defaults mirror settings.ts defaultSettings (which mirrors config.ts) in
// the AppSettings field shape.
export const DEFAULT_SETTINGS: AppSettings = {
  maxHoursPerDay: Number(defaultSettings.max_hours_per_day),
  correctionWindowDays: Number(defaultSettings.correction_window_days),
  hoursTolerance: Number(defaultSettings.hours_tolerance),
  reminderSubject: defaultSettings.reminder_subject,
  reminderBody: defaultSettings.reminder_body,
  aiModel: defaultSettings.ai_model,
};

export const DEFAULT_REMINDER_SUBJECT = defaultSettings.reminder_subject;
export const DEFAULT_REMINDER_BODY = defaultSettings.reminder_body;

// All settings merged over defaults in one read. Lenient by design: a missing
// or invalid stored value falls back to the default rather than throwing —
// strictness lives at write time (validateSettings in the settings action).
export async function getSettings(): Promise<AppSettings> {
  const rows = await db
    .select({ key: appSetting.key, value: appSetting.value })
    .from(appSetting);
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  const resolved = {} as Record<SettingKey, string>;
  for (const key of SETTING_KEY_LIST) {
    const raw = stored.get(key);
    const parsed = raw === undefined ? null : parseSetting(key, raw);
    resolved[key] =
      parsed && parsed.ok && parsed.value !== null
        ? parsed.value
        : defaultSettings[key];
  }

  return {
    maxHoursPerDay: Number(resolved.max_hours_per_day),
    correctionWindowDays: Number(resolved.correction_window_days),
    hoursTolerance: Number(resolved.hours_tolerance),
    reminderSubject: resolved.reminder_subject,
    reminderBody: resolved.reminder_body,
    aiModel: resolved.ai_model,
  };
}
