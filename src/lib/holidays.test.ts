import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeObservedHolidays,
  deadlineForWeek,
  expectedHours,
} from "./holidays.ts";

const holidaysFor = (year: number) =>
  computeObservedHolidays(year).map((h) => h.date);

test("2025 observed holidays (full calendar year)", () => {
  assert.deepEqual(computeObservedHolidays(2025), [
    { name: "New Year's Day", date: "2025-01-01" },
    { name: "Memorial Day", date: "2025-05-26" },
    { name: "Independence Day", date: "2025-07-04" },
    { name: "Labor Day", date: "2025-09-01" },
    { name: "Thanksgiving", date: "2025-11-27" },
    { name: "Christmas", date: "2025-12-25" },
  ]);
});

test("fixed-date observance shifts in 2026/2027 match the spec table", () => {
  const h26 = new Map(computeObservedHolidays(2026).map((h) => [h.name, h.date]));
  assert.equal(h26.get("Independence Day"), "2026-07-03");
  const h27 = new Map(computeObservedHolidays(2027).map((h) => [h.name, h.date]));
  assert.equal(h27.get("Independence Day"), "2027-07-05");
  assert.equal(h27.get("Christmas"), "2027-12-24");
});

test("2026 observed holidays match the spec table", () => {
  assert.deepEqual(computeObservedHolidays(2026), [
    { name: "New Year's Day", date: "2026-01-01" },
    { name: "Memorial Day", date: "2026-05-25" },
    { name: "Independence Day", date: "2026-07-03" },
    { name: "Labor Day", date: "2026-09-07" },
    { name: "Thanksgiving", date: "2026-11-26" },
    { name: "Christmas", date: "2026-12-25" },
  ]);
});

test("2027 observed holidays match the spec table", () => {
  assert.deepEqual(computeObservedHolidays(2027), [
    { name: "New Year's Day", date: "2027-01-01" },
    { name: "Memorial Day", date: "2027-05-31" },
    { name: "Independence Day", date: "2027-07-05" },
    { name: "Labor Day", date: "2027-09-06" },
    { name: "Thanksgiving", date: "2027-11-25" },
    { name: "Christmas", date: "2027-12-24" },
  ]);
});

test("TC-101: deadline is the Monday after week end", () => {
  assert.equal(deadlineForWeek("2026-08-19", holidaysFor(2026)), "2026-08-31");
});

test("TC-102: Labor Day Monday shifts deadline to prior Friday", () => {
  assert.equal(deadlineForWeek("2026-08-26", holidaysFor(2026)), "2026-09-04");
});

test("expectedHours adjusts for holidays in the week", () => {
  const h26 = holidaysFor(2026);
  assert.equal(expectedHours("2026-09-02", 40, h26), 32);
  assert.equal(expectedHours("2026-09-02", 24, h26), 19.25);
  assert.equal(expectedHours("2026-08-26", 40, h26), 40);
  assert.equal(expectedHours("2026-11-25", 40, h26), 32);
});
