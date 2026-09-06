import { test } from "node:test";
import assert from "node:assert/strict";

import {
  filterExisting,
  holidayDayFraction,
  holidayOooEntries,
  isEditableTimesheetState,
  OOO_CATEGORY_NAME,
  OOO_NOTE,
} from "./holiday-ooo.ts";
import { expectedHours } from "./holidays.ts";

// Wed–Tue week containing Labor Day 2026 (Mon 2026-09-07).
const WEEK = "2026-09-02";
const LABOR_DAY = { name: "Labor Day", date: "2026-09-07" };
const THANKSGIVING = { name: "Thanksgiving", date: "2026-11-26" };

test("holiday-date matching within a Wed-Tue week", () => {
  const entries = holidayOooEntries(WEEK, [LABOR_DAY], 40);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, "2026-09-07");
});

test("holidays outside the week are ignored", () => {
  assert.deepEqual(holidayOooEntries(WEEK, [THANKSGIVING], 40), []);
});

test("hours equal the day-fraction used by expectedHours", () => {
  // 40h week, 1 holiday → expected 32 = 40 − day-fraction(8)
  assert.equal(holidayDayFraction(40), 8);
  assert.equal(expectedHours(WEEK, 40, [LABOR_DAY.date]), 32);
  const entries = holidayOooEntries(WEEK, [LABOR_DAY], 40);
  assert.equal(entries[0].hours, 8);

  // Non-divisible standard hours still round to 0.25h, matching the
  // per-day term of the expectedHours formula.
  assert.equal(holidayDayFraction(24), 4.75);
  const partTime = holidayOooEntries(WEEK, [LABOR_DAY], 24);
  assert.equal(partTime[0].hours, 4.75);
  assert.equal(isValidQuarter(partTime[0].hours), true);
});

test("entries carry the Out of Office category and auto note", () => {
  const [entry] = holidayOooEntries(WEEK, [LABOR_DAY], 40);
  assert.equal(entry.categoryName, OOO_CATEGORY_NAME);
  assert.equal(entry.note, OOO_NOTE);
});

test("multiple holidays in one week produce one entry each, sorted", () => {
  const entries = holidayOooEntries(
    WEEK,
    [
      { name: "Later Holiday", date: "2026-09-08" },
      { name: "Early Holiday", date: "2026-09-03" },
      THANKSGIVING,
    ],
    40,
  );
  assert.deepEqual(
    entries.map((e) => e.date),
    ["2026-09-03", "2026-09-08"],
  );
});

test("filterExisting skips holiday dates with any existing entry", () => {
  const entries = [
    { date: "2026-09-07", hours: 8, note: OOO_NOTE, categoryName: OOO_CATEGORY_NAME },
    { date: "2026-11-26", hours: 8, note: OOO_NOTE, categoryName: OOO_CATEGORY_NAME },
  ];

  // No entries yet → everything is pending.
  assert.equal(filterExisting(entries, []).length, 2);

  // Any entry on a holiday date suppresses it — even a project entry.
  const existing = ["2026-11-26"];
  assert.deepEqual(
    filterExisting(entries, existing).map((e) => e.date),
    ["2026-09-07"],
  );

  // Both covered → nothing to insert (idempotent reopen).
  assert.deepEqual(
    filterExisting(entries, ["2026-09-07", "2026-11-26"]),
    [],
  );
});

test("isEditableTimesheetState guards draft-like states only", () => {
  for (const state of ["not_started", "in_progress"]) {
    assert.equal(isEditableTimesheetState(state), true, state);
  }
  for (const state of ["submitted", "in_correction", "approved", "locked"]) {
    assert.equal(isEditableTimesheetState(state), false, state);
  }
});

function isValidQuarter(hours: number): boolean {
  const quarters = hours * 4;
  return Math.abs(quarters - Math.round(quarters)) < 1e-9;
}
