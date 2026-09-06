import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCorrectionValues,
  formatHoursValue,
  shouldMarkRestated,
  validateCorrection,
  validateCorrectionReason,
} from "./corrections.ts";

test("TS-026: missing or blank reason is rejected", () => {
  for (const reason of [null, undefined, "", "   ", "\t\n"]) {
    const check = validateCorrectionReason(reason);
    assert.equal(check.ok, false, JSON.stringify(reason));
    if (!check.ok) {
      assert.equal(check.error, "A reason is required for every correction.");
    }
  }
});

test("TS-026: a non-blank reason passes", () => {
  assert.equal(validateCorrectionReason("Client clarified scope").ok, true);
  assert.equal(validateCorrectionReason("  typo fix  ").ok, true);
});

test("TS-026: reason is mandatory even when hours are valid", () => {
  const check = validateCorrection({ reason: "   ", hours: 7.5 });
  assert.equal(check.ok, false);
  if (!check.ok) {
    assert.equal(check.error, "A reason is required for every correction.");
  }
});

test("TS-028: corrected hours must be non-negative 0.25 increments", () => {
  assert.equal(validateCorrection({ reason: "fix", hours: 0 }).ok, true);
  assert.equal(validateCorrection({ reason: "fix", hours: 7.75 }).ok, true);
  assert.equal(validateCorrection({ reason: "fix", hours: 1.1 }).ok, false);
  assert.equal(validateCorrection({ reason: "fix", hours: -2 }).ok, false);
  assert.equal(validateCorrection({ reason: "fix", hours: NaN }).ok, false);
});

test("TS-028: log payload for a hours-only correction", () => {
  const values = buildCorrectionValues({
    originalHours: 8,
    newHours: 6.25,
    originalNote: "note",
    newNote: "note",
  });
  assert.equal(values.changed, true);
  assert.equal(values.field, "hours");
  assert.equal(values.originalValue, "hours=8");
  assert.equal(values.newValue, "hours=6.25");
});

test("TS-028: log payload includes the note only when it changed", () => {
  const values = buildCorrectionValues({
    originalHours: 8,
    newHours: 8,
    originalNote: null,
    newNote: "approved by PM",
  });
  assert.equal(values.changed, true);
  assert.equal(values.field, "hours,note");
  assert.equal(values.originalValue, "hours=8; note=");
  assert.equal(values.newValue, "hours=8; note=approved by PM");
});

test("TS-028: unchanged entries are not flagged as corrections", () => {
  const values = buildCorrectionValues({
    originalHours: 7.5,
    newHours: 7.5,
    originalNote: "same",
    newNote: "same",
  });
  assert.equal(values.changed, false);
});

test("TS-028: float drift on quarter-rounded hours is not a change", () => {
  const values = buildCorrectionValues({
    originalHours: 7.75,
    newHours: 7.749999999,
    originalNote: null,
    newNote: null,
  });
  assert.equal(values.changed, false);
});

test("formatHoursValue encodes quarter-rounded hours compactly", () => {
  assert.equal(formatHoursValue(8), "8");
  assert.equal(formatHoursValue(6.25), "6.25");
  assert.equal(formatHoursValue(7.5), "7.5");
  assert.equal(formatHoursValue(7.749999999), "7.75");
});

test("TS-029: a correction after the period was finalized marks it restated", () => {
  assert.equal(
    shouldMarkRestated({ closedAt: new Date("2026-02-01T00:00:00.000Z") }),
    true,
  );
});

test("TS-029: a correction before finalize does NOT mark it restated", () => {
  // Close initiated but the correction window is still open — the period
  // was never finalized, so there is nothing to restate.
  assert.equal(shouldMarkRestated({ closedAt: null }), false);
});

test("TS-029: no close row means no restated bump", () => {
  assert.equal(shouldMarkRestated(null), false);
  assert.equal(shouldMarkRestated(undefined), false);
});
