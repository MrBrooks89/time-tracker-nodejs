import { test } from "node:test";
import assert from "node:assert/strict";

import { formatHours, isValidHoursIncrement } from "./entry-validation.ts";

test("TC-007/TC-008: 0.25-hour increment validation", () => {
  for (const h of [0, 0.25, 1, 2.25, 8, 7.75]) {
    assert.equal(isValidHoursIncrement(h), true, String(h));
  }
  for (const h of [1.1, 1.33, -0.25, NaN, Infinity]) {
    assert.equal(isValidHoursIncrement(h), false, String(h));
  }
});

test("TC-009: negative hours are not valid", () => {
  assert.equal(isValidHoursIncrement(-1), false);
});

test("formatHours formats compact hour labels", () => {
  assert.equal(formatHours(8), "8h");
  assert.equal(formatHours(6.25), "6.25h");
  assert.equal(formatHours(0.25), "0.25h");
  assert.equal(formatHours(40), "40h");
});
