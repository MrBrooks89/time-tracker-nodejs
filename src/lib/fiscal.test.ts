import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FISCAL_PERIODS,
  addWeeks,
  currentWeek,
  findPeriod,
  findWeek,
  isWeekStart,
  weekDates,
  weekEnterable,
  weekStart,
  weeksInPeriod,
} from "./fiscal.ts";

const TODAY = new Date("2026-09-03T10:00:00");

test("weekStart resolves Wednesday-start weeks", () => {
  assert.equal(weekStart(new Date("2026-09-03T12:00:00")), "2026-09-02");
  assert.equal(weekStart(new Date("2026-09-02T08:00:00")), "2026-09-02");
  assert.equal(weekStart(new Date("2026-09-08T18:00:00")), "2026-09-02");
  assert.equal(weekStart(new Date("2026-01-06T12:00:00")), "2025-12-31");
});

test("findWeek maps to fiscal period and week index", () => {
  const week = findWeek("2026-09-03");
  assert.ok(week);
  assert.equal(week.weekStartDate, "2026-09-02");
  assert.equal(week.period.fiscalYear, 2026);
  assert.equal(week.period.quarter, 4);
  assert.equal(week.period.periodNumber, 12);
  assert.equal(week.weekIndex, 1);
});

test("TC-029: week crossing calendar year stays in FY26 P3", () => {
  const week = findWeek("2026-01-02");
  assert.ok(week);
  assert.equal(week.weekStartDate, "2025-12-31");
  assert.equal(week.period.fiscalYear, 2026);
  assert.equal(week.period.periodNumber, 3);
  assert.equal(week.period.quarter, 1);
});

test("weeksInPeriod lists week starts", () => {
  const p12 = FISCAL_PERIODS.find(
    (p) => p.fiscalYear === 2026 && p.periodNumber === 12,
  );
  assert.ok(p12);
  assert.deepEqual(weeksInPeriod(p12), [
    "2026-09-02",
    "2026-09-09",
    "2026-09-16",
    "2026-09-23",
  ]);
});

test("weekEnterable: past and current weeks only", () => {
  assert.equal(weekEnterable("2026-09-02", TODAY), true);
  assert.equal(weekEnterable("2026-09-09", TODAY), false);
  assert.equal(weekEnterable("2025-10-01", TODAY), true);
  assert.equal(weekEnterable("2026-10-07", TODAY), false);
});

test("fiscal calendar structure: Wed starts, Tue ends, contiguous, 52 weeks", () => {
  const weekday = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };
  const toMs = (s: string) =>
    Date.UTC(
      Number(s.slice(0, 4)),
      Number(s.slice(5, 7)) - 1,
      Number(s.slice(8, 10)),
    );
  let prev = FISCAL_PERIODS[0];
  assert.equal(weekday(prev.startDate), 3);
  assert.equal(weekday(prev.endDate), 2);
  for (const period of FISCAL_PERIODS.slice(1)) {
    assert.equal(weekday(period.startDate), 3);
    assert.equal(weekday(period.endDate), 2);
    assert.equal(toMs(period.startDate) - toMs(prev.endDate), 86_400_000);
    prev = period;
  }
  for (const fy of [2026, 2027]) {
    const total = FISCAL_PERIODS.filter((p) => p.fiscalYear === fy)
      .reduce((sum, p) => sum + p.weekCount, 0);
    assert.equal(total, 52, `FY${fy} should have 52 weeks`);
  }
});

test("weekDates and helpers", () => {
  assert.deepEqual(weekDates("2026-09-02"), [
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
    "2026-09-07",
    "2026-09-08",
  ]);
  assert.equal(isWeekStart("2026-09-02"), true);
  assert.equal(isWeekStart("2026-09-03"), false);
  assert.equal(addWeeks("2026-09-02", 1), "2026-09-09");
  assert.equal(addWeeks("2026-09-02", -1), "2026-08-26");
  assert.equal(currentWeek(TODAY), "2026-09-02");
  assert.equal(findPeriod("2026-09-03")?.periodNumber, 12);
  assert.equal(findPeriod("2028-01-01"), null);
});
