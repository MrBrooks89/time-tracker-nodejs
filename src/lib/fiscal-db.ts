// FC-008: hydrate fiscal.ts's runtime period index from the fiscal_period
// table. Called by the calendar admin page and its server actions so generated
// future-year periods resolve in findPeriod/findWeek immediately — the DB is
// the live source, no caching layer is involved.
import { db } from "@/db";
import { fiscalPeriod as fiscalPeriodTable } from "@/db/schema";
import { registerPeriods, type FiscalPeriodInfo } from "@/lib/fiscal";

export async function syncPeriodsFromDb(): Promise<void> {
  const rows = await db.select().from(fiscalPeriodTable);
  const periods: FiscalPeriodInfo[] = rows.map((row) => ({
    fiscalYear: row.fiscalYear,
    quarter: row.quarter,
    periodNumber: row.periodNumber,
    startDate: row.startDate,
    endDate: row.endDate,
    weekCount: row.weekCount,
  }));
  registerPeriods(periods);
}
