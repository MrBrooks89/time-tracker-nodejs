import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CORRECTION_WINDOW_DAYS,
  HOURS_TOLERANCE,
  MAX_HOURS_PER_DAY,
} from "./config.ts";
import {
  SETTING_KEYS,
  defaultSettings,
  parseSetting,
  validateSettings,
} from "./settings.ts";

test("defaultSettings mirror config.ts constants", () => {
  assert.equal(
    Number(defaultSettings.max_hours_per_day),
    MAX_HOURS_PER_DAY,
  );
  assert.equal(
    Number(defaultSettings.correction_window_days),
    CORRECTION_WINDOW_DAYS,
  );
  assert.equal(Number(defaultSettings.hours_tolerance), HOURS_TOLERANCE);
  assert.equal(defaultSettings.ai_model, "");
});

test("defaultSettings pass their own validation", () => {
  const result = validateSettings(defaultSettings);
  assert.deepEqual(result.errors, {});
  assert.equal(result.ok, true);
});

test("defaultSettings templates carry the documented placeholders", () => {
  for (const placeholder of ["{week}", "{due_date}"]) {
    assert.ok(
      defaultSettings.reminder_subject.includes(placeholder),
      `subject missing ${placeholder}`,
    );
  }
  for (const placeholder of ["{partner}", "{week}", "{due_date}"]) {
    assert.ok(
      defaultSettings.reminder_body.includes(placeholder),
      `body missing ${placeholder}`,
    );
  }
});

test("parseSetting: max_hours_per_day accepts 1–24 whole numbers", () => {
  for (const value of ["1", "16", "24", " 16 "]) {
    assert.equal(parseSetting("max_hours_per_day", value).ok, true, value);
  }
  assert.equal(parseSetting("max_hours_per_day", "16").value, "16");
  assert.equal(parseSetting("max_hours_per_day", " 16 ").value, "16");
});

test("parseSetting: max_hours_per_day rejects out-of-bounds and non-integers", () => {
  for (const value of ["0", "25", "16.5", "-8", "abc", ""]) {
    const result = parseSetting("max_hours_per_day", value);
    assert.equal(result.ok, false, value);
    assert.ok(result.error, value);
    assert.equal(result.value, null);
  }
});

test("parseSetting: correction_window_days accepts 1–20", () => {
  for (const value of ["1", "5", "20"]) {
    assert.equal(
      parseSetting("correction_window_days", value).ok,
      true,
      value,
    );
  }
  for (const value of ["0", "21", "2.5", "five", ""]) {
    assert.equal(
      parseSetting("correction_window_days", value).ok,
      false,
      value,
    );
  }
});

test("parseSetting: hours_tolerance accepts 0–1 inclusive", () => {
  for (const value of ["0", "0.8", "1", "0.25", " .5 "]) {
    assert.equal(parseSetting("hours_tolerance", value).ok, true, value);
  }
  assert.equal(parseSetting("hours_tolerance", " .5 ").value, "0.5");
});

test("parseSetting: hours_tolerance rejects out-of-range and non-numeric", () => {
  for (const value of ["-0.1", "1.2", "2", "80%", "abc", ""]) {
    assert.equal(parseSetting("hours_tolerance", value).ok, false, value);
  }
});

test("parseSetting: templates must be non-empty with required placeholders", () => {
  assert.equal(
    parseSetting("reminder_subject", "Week of {week} due {due_date}").ok,
    true,
  );
  assert.equal(parseSetting("reminder_subject", "").ok, false);
  assert.equal(parseSetting("reminder_subject", "   ").ok, false);
  assert.equal(parseSetting("reminder_subject", "No placeholders").ok, false);
  assert.equal(
    parseSetting("reminder_subject", "Week of {week} only").ok,
    false,
  );
  assert.equal(
    parseSetting(
      "reminder_body",
      "Hi {partner}, week {week} due {due_date}.",
    ).ok,
    true,
  );
  assert.equal(parseSetting("reminder_body", "Hi there, no placeholders.").ok, false);
});

test("parseSetting: ai_model is a free string; empty means unset", () => {
  assert.equal(parseSetting("ai_model", "").ok, true);
  assert.equal(parseSetting("ai_model", "").value, "");
  assert.equal(
    parseSetting("ai_model", "openai/gpt-5.2").value,
    "openai/gpt-5.2",
  );
  assert.equal(parseSetting("ai_model", "  x  ").value, "x");
});

test("validateSettings: mixed batch reports per-key errors and parsed values", () => {
  const result = validateSettings({
    max_hours_per_day: "12",
    hours_tolerance: "1.5",
    correction_window_days: "5",
    reminder_subject: "broken",
    ai_model: "anthropic/claude-opus-4",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.hours_tolerance, "Hours tolerance must be between 0 and 1.");
  assert.ok(result.errors.reminder_subject);
  assert.equal(result.parsed.max_hours_per_day, "12");
  assert.equal(result.parsed.correction_window_days, "5");
  assert.equal(result.parsed.ai_model, "anthropic/claude-opus-4");
  assert.equal(result.parsed.hours_tolerance, undefined);
});

test("validateSettings: all-valid batch is ok with canonical parsed values", () => {
  const result = validateSettings({
    max_hours_per_day: " 8 ",
    correction_window_days: "10",
    hours_tolerance: "0.5",
    reminder_subject: "Due {due_date} — week {week}",
    reminder_body: "Hi {partner}, week {week} due {due_date}.",
    ai_model: "",
  });
  assert.deepEqual(result.errors, {});
  assert.equal(result.ok, true);
  assert.equal(result.parsed.max_hours_per_day, "8");
  assert.equal(result.parsed.hours_tolerance, "0.5");
});

test("validateSettings: absent and unknown keys are ignored", () => {
  const result = validateSettings({
    hours_tolerance: "0.8",
    rogue_key: "whatever",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.parsed), ["hours_tolerance"]);
});

test("SETTING_KEYS enumerates exactly the six supported keys", () => {
  assert.deepEqual([...SETTING_KEYS].sort(), [
    "ai_model",
    "correction_window_days",
    "hours_tolerance",
    "max_hours_per_day",
    "reminder_body",
    "reminder_subject",
  ]);
});
