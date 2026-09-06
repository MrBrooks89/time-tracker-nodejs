import { test } from "node:test";
import assert from "node:assert/strict";

import { FISCAL_PERIODS } from "./fiscal.ts";
import { computeObservedHolidays, expectedHours } from "./holidays.ts";
import {
  canFinalize,
  correctionWindowEndsAt,
  exceptionFlags,
  exceptionFlagsForPeriod,
  weeksOfPeriod,
} from "./close.ts";

const holidaysFor = (year: number) =>
  computeObservedHolidays(year).map((h) => h.date);

const periodOf = (fy: number, periodNumber: number) => {
  const period = FISCAL_PERIODS.find(
    (p) => p.fiscalYear === fy && p.periodNumber === periodNumber,
  );
  assert.ok(period, `FY${fy} P${periodNumber} not found`);
  return period;
};

test("weeksOfPeriod lists week starts for a 4-week period", () => {
  const p12 = periodOf(2026, 12);
  assert.deepEqual(weeksOfPeriod(p12), [
    "2026-09-02",
    "2026-09-09",
    "2026-09-16",
    "2026-09-23",
  ]);
});

test("weeksOfPeriod lists week starts for a 5-week period", () => {
  const p2 = periodOf(2026, 2);
  assert.deepEqual(weeksOfPeriod(p2), [
    "2025-10-29",
    "2025-11-05",
    "2025-11-12",
    "2025-11-19",
    "2025-11-26",
  ]);
});

test("exceptionFlags: unsubmitted flag for not_started/in_progress", () => {
  assert.deepEqual(
    exceptionFlags(
      { userId: "u1", state: "not_started", totalHours: 0, expectedHours: 40 },
      0.8,
    ),
    { userId: "u1", flags: ["unsubmitted"] },
  );
  assert.deepEqual(
    exceptionFlags(
      { userId: "u2", state: "in_progress", totalHours: 10, expectedHours: 40 },
      0.8,
    ),
    { userId: "u2", flags: ["unsubmitted"] },
  );
});

test("exceptionFlags: hours_outlier when beyond tolerance", () => {
  // 5h vs 40h expected → |5−40|/40 = 0.875 > 0.8 tolerance.
  assert.deepEqual(
    exceptionFlags(
      { userId: "u1", state: "submitted", totalHours: 5, expectedHours: 40 },
      0.8,
    ),
    { userId: "u1", flags: ["hours_outlier"] },
  );
});

test("exceptionFlags: no flags when within tolerance", () => {
  // |30−40|/40 = 0.25 ≤ 0.8.
  assert.deepEqual(
    exceptionFlags(
      { userId: "u1", state: "submitted", totalHours: 30, expectedHours: 40 },
      0.8,
    ),
    { userId: "u1", flags: [] },
  );
  // Exact boundary: |8−40|/40 = 0.8 is NOT > 0.8 → no flag.
  assert.deepEqual(
    exceptionFlags(
      { userId: "u2", state: "approved", totalHours: 8, expectedHours: 40 },
      0.8,
    ),
    { userId: "u2", flags: [] },
  );
});

test("exceptionFlags: holiday-adjusted expected hours produce no flag", () => {
  // Week of 2026-09-02 contains Labor Day (2026-09-07) → 40h becomes 32h.
  const h26 = holidaysFor(2026);
  const expected = expectedHours("2026-09-02", 40, h26);
  assert.equal(expected, 32);
  assert.deepEqual(
    exceptionFlags(
      { userId: "u1", state: "submitted", totalHours: 32, expectedHours: expected },
      0.8,
    ),
    { userId: "u1", flags: [] },
  );
});

test("exceptionFlags: expected 0 skips the outlier check", () => {
  // Any total against a 0 baseline stays unflagged (no division by zero).
  assert.deepEqual(
    exceptionFlags(
      { userId: "u1", state: "submitted", totalHours: 40, expectedHours: 0 },
      0.8,
    ),
    { userId: "u1", flags: [] },
  );
});

test("exceptionFlagsForPeriod: mixed sheet outcomes", () => {
  const results = exceptionFlagsForPeriod(
    [
      { userId: "u1", state: "not_started", totalHours: 0, expectedHours: 40 },
      { userId: "u2", state: "submitted", totalHours: 5, expectedHours: 40 },
      { userId: "u3", state: "approved", totalHours: 40, expectedHours: 40 },
    ],
    0.8,
  );
  assert.deepEqual(results, [
    { userId: "u1", flags: ["unsubmitted"] },
    { userId: "u2", flags: ["hours_outlier"] },
    { userId: "u3", flags: [] },
  ]);
});

test("canFinalize: true when every sheet is submitted-or-better", () => {
  assert.equal(
    canFinalize(
      [
        { state: "submitted" },
        { state: "approved" },
        { state: "locked" },
      ],
      false,
    ),
    true,
  );
});

test("canFinalize: false while a sheet is open or in correction", () => {
  for (const state of ["not_started", "in_progress", "in_correction"] as const) {
    assert.equal(
      canFinalize([{ state: "submitted" }, { state }], false),
      false,
      state,
    );
  }
});

test("canFinalize: window elapsed overrides open sheets (D5)", () => {
  assert.equal(
    canFinalize([{ state: "in_correction" }, { state: "not_started" }], true),
    true,
  );
});

test("correctionWindowEndsAt: plain 5 business days", () => {
  // Monday 2026-09-14 + 5 business days → Monday 2026-09-21.
  const end = correctionWindowEndsAt(
    new Date("2026-09-14T10:00:00Z"),
    holidaysFor(2026),
    5,
  );
  assert.equal(end.toISOString().slice(0, 10), "2026-09-21");
});

test("correctionWindowEndsAt: window spanning a weekend", () => {
  // Friday 2026-09-18 + 5 business days skips Sat/Sun → Friday 2026-09-25.
  const end = correctionWindowEndsAt(
    new Date("2026-09-18T16:00:00Z"),
    holidaysFor(2026),
    5,
  );
  assert.equal(end.toISOString().slice(0, 10), "2026-09-25");
});

test("correctionWindowEndsAt: window spanning Labor Day 2026-09-07", () => {
  // Thursday 2026-09-03 + 5 business days: Fri 4, [Sat/Sun], Mon 7 is Labor
  // Day (observed, from holidays.ts rules), so Tue 8, Wed 9, Thu 10, Fri 11.
  const h26 = holidaysFor(2026);
  assert.ok(h26.includes("2026-09-07"), "Labor Day 2026-09-07 observed");
  const end = correctionWindowEndsAt(
    new Date("2026-09-03T09:00:00Z"),
    h26,
    5,
  );
  assert.equal(end.toISOString().slice(0, 10), "2026-09-11");
});

test("correctionWindowEndsAt: result always lands on a business day", () => {
  const h26 = holidaysFor(2026);
  const isBusinessDay = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return weekday !== 0 && weekday !== 6 && !h26.includes(dateStr);
  };
  // Sweep a full week of initiation dates; every window end must be a
  // business day.
  for (const start of [
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
  ]) {
    const end = correctionWindowEndsAt(
      new Date(`${start}T12:00:00Z`),
      h26,
      5,
    );
    const endStr = end.toISOString().slice(0, 10);
    assert.equal(isBusinessDay(endStr), true, `from ${start} → ${endStr}`);
  }
});
