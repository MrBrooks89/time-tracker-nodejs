import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FISCAL_PERIODS,
  allPeriods,
  findPeriod,
  generateFiscalYearPeriods,
  isWeekStart,
  registerPeriods,
} from "./fiscal.ts";

test("generateFiscalYearPeriods reproduces the static FY2027 calendar", () => {
  // The generator must be a faithful re-derivation of the seeded pattern:
  // FY2027's first period starts 2026-09-30 (day after FY26 P12 ends).
  const generated = generateFiscalYearPeriods(2027, "2026-09-30");
  const seeded = FISCAL_PERIODS.filter((p) => p.fiscalYear === 2027);
  assert.deepEqual(generated, seeded);
});

test("generated years are structurally sound (Wed starts, Tue ends, 52 weeks)", () => {
  const generated = generateFiscalYearPeriods(2028, "2027-09-29");
  assert.equal(generated.length, 12);
  const weekday = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };
  let prev = generated[0];
  assert.equal(isWeekStart(prev.startDate), true);
  assert.equal(weekday(prev.endDate), 2);
  for (const period of generated.slice(1)) {
    assert.equal(isWeekStart(period.startDate), true);
    assert.equal(weekday(period.endDate), 2);
    assert.equal(period.quarter, Math.floor((period.periodNumber - 1) / 3) + 1);
    assert.equal(period.weekCount, [4, 5, 5, 4, 5, 4, 4, 5, 4, 4, 4, 4][period.periodNumber - 1]);
    prev = period;
  }
  assert.equal(
    generated.reduce((sum, p) => sum + p.weekCount, 0),
    52,
  );
});

test("registerPeriods makes DB-generated years resolve in findPeriod", () => {
  assert.equal(findPeriod("2028-01-01"), null);
  registerPeriods(generateFiscalYearPeriods(2028, "2027-09-29"));
  const period = findPeriod("2028-01-01");
  assert.ok(period);
  assert.equal(period.fiscalYear, 2028);
  assert.equal(period.periodNumber, 3);
  assert.equal(allPeriods().length, FISCAL_PERIODS.length + 12);
});
