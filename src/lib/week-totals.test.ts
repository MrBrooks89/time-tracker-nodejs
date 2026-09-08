import { test } from "node:test";
import assert from "node:assert/strict";

import { sumHoursByDate, type DaysLike } from "./week-totals.ts";

test("sums hours per date across rows", () => {
  const rows: DaysLike[] = [
    { days: { "2026-09-01": 4, "2026-09-02": 2 } },
    { days: { "2026-09-01": 4, "2026-09-02": 6 } },
  ];
  assert.deepEqual(
    sumHoursByDate(rows, ["2026-09-01", "2026-09-02"]),
    { "2026-09-01": 8, "2026-09-02": 8 },
  );
});

test("treats missing days as zero", () => {
  const rows: DaysLike[] = [{ days: { "2026-09-01": 3 } }, { days: {} }];
  assert.deepEqual(
    sumHoursByDate(rows, ["2026-09-01", "2026-09-02"]),
    { "2026-09-01": 3, "2026-09-02": 0 },
  );
});

test("avoids floating-point artifacts", () => {
  const rows: DaysLike[] = [
    { days: { "2026-09-01": 0.1 } },
    { days: { "2026-09-01": 0.2 } },
  ];
  assert.equal(sumHoursByDate(rows, ["2026-09-01"])["2026-09-01"], 0.3);
});

test("returns zero for empty rows", () => {
  assert.deepEqual(
    sumHoursByDate([], ["2026-09-01", "2026-09-02"]),
    { "2026-09-01": 0, "2026-09-02": 0 },
  );
});
