// Phase 6 (NF-012 / D7): admin-configurable settings. Pure parse/validate
// layer — no DB imports. `config.ts` constants remain the defaults; the DB
// read layer (Phase E) stays thin and separate so this module never touches
// storage. Values are stored as text in app_setting and canonicalized here.

export const SETTING_KEYS = [
  "max_hours_per_day",
  "correction_window_days",
  "hours_tolerance",
  "reminder_subject",
  "reminder_body",
  "ai_model",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Placeholder contract for reminder templates (renderTemplate in email.ts). */
export const TEMPLATE_PLACEHOLDERS = {
  partner: "Partner display name",
  week: "Week start date (YYYY-MM-DD)",
  due_date: "Submission deadline date (YYYY-MM-DD)",
  hours: "Hours value (e.g. weekly total)",
} as const;

export type TemplatePlaceholder = keyof typeof TEMPLATE_PLACEHOLDERS;

/** Placeholders each template setting must contain (guards against broken
 * reminder emails after an admin edit). */
const REQUIRED_TEMPLATE_PLACEHOLDERS: Partial<
  Record<SettingKey, readonly TemplatePlaceholder[]>
> = {
  reminder_subject: ["week", "due_date"],
  reminder_body: ["partner", "week", "due_date"],
};

// Defaults mirror src/lib/config.ts (NF-012: config constants become the
// seeded setting values) and the in-app reminder copy.
export const defaultSettings: Record<SettingKey, string> = {
  max_hours_per_day: "16",
  correction_window_days: "5",
  hours_tolerance: "0.8",
  reminder_subject: "Timesheet reminder — week of {week} due {due_date}",
  reminder_body:
    "Hi {partner},\n\nYour timesheet for the week of {week} is due by {due_date}. Please submit it so the period close can proceed.\n\n— Time Tracker",
  ai_model: "",
};

export interface SettingParse {
  ok: boolean;
  /** Canonical stored value when ok, null otherwise. */
  value: string | null;
  error: string | null;
}

function parsePositiveInt(
  raw: string,
  min: number,
  max: number,
  label: string,
): SettingParse {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, value: null, error: `${label} must be a whole number.` };
  }
  const parsed = Number(trimmed);
  if (parsed < min || parsed > max) {
    return {
      ok: false,
      value: null,
      error: `${label} must be between ${min} and ${max}.`,
    };
  }
  return { ok: true, value: String(parsed), error: null };
}

function parseTemplate(
  raw: string,
  required: readonly TemplatePlaceholder[],
  label: string,
): SettingParse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, value: null, error: `${label} must not be empty.` };
  }
  const missing = required.filter(
    (key) => !trimmed.includes(`{${key}}`),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      value: null,
      error: `${label} is missing required placeholder(s): ${missing
        .map((k) => `{${k}}`)
        .join(", ")}.`,
    };
  }
  return { ok: true, value: raw, error: null };
}

/** Parses and validates one setting value; returns the canonical string that
 * should be stored (numbers normalized; templates stored verbatim so admin
 * formatting survives — validation runs on the trimmed copy) or an error. */
export function parseSetting(key: SettingKey, value: string): SettingParse {
  switch (key) {
    case "max_hours_per_day":
      return parsePositiveInt(value, 1, 24, "Max hours per day");
    case "correction_window_days":
      return parsePositiveInt(value, 1, 20, "Correction window days");
    case "hours_tolerance": {
      const trimmed = value.trim();
      const parsed = Number(trimmed);
      if (trimmed.length === 0 || !Number.isFinite(parsed)) {
        return {
          ok: false,
          value: null,
          error: "Hours tolerance must be a number.",
        };
      }
      if (parsed < 0 || parsed > 1) {
        return {
          ok: false,
          value: null,
          error: "Hours tolerance must be between 0 and 1.",
        };
      }
      return { ok: true, value: String(parsed), error: null };
    }
    case "reminder_subject":
      return parseTemplate(
        value,
        REQUIRED_TEMPLATE_PLACEHOLDERS.reminder_subject ?? [],
        "Reminder subject",
      );
    case "reminder_body":
      return parseTemplate(
        value,
        REQUIRED_TEMPLATE_PLACEHOLDERS.reminder_body ?? [],
        "Reminder body",
      );
    case "ai_model":
      // Free string; "" means unset (helper falls back to gateway default).
      return { ok: true, value: value.trim(), error: null };
  }
}

export interface SettingsValidation {
  ok: boolean;
  errors: Partial<Record<SettingKey, string>>;
  /** Canonical values for every key present (and valid) in the input. */
  parsed: Partial<Record<SettingKey, string>>;
}

/** Validates a batch of settings (e.g. the /settings form submission). Only
 * keys present in the input are checked; absent keys fall back to defaults
 * at read time. Unknown keys are ignored. */
export function validateSettings(
  input: Record<string, string>,
): SettingsValidation {
  const errors: Partial<Record<SettingKey, string>> = {};
  const parsed: Partial<Record<SettingKey, string>> = {};
  for (const key of SETTING_KEYS) {
    if (!(key in input)) continue;
    const result = parseSetting(key, input[key]);
    if (result.ok && result.value !== null) {
      parsed[key] = result.value;
    } else {
      errors[key] = result.error ?? "Invalid value.";
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, parsed };
}
