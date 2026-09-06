import { asc } from "drizzle-orm";

import { db } from "@/db";
import {
  fiscalPeriod as fiscalPeriodTable,
  holiday as holidayTable,
  periodClose as periodCloseTable,
  timesheet as timesheetTable,
} from "@/db/schema";
import { requireRole } from "@/lib/permissions";
import { syncPeriodsFromDb } from "@/lib/fiscal-db";
import { addDays, weekStart } from "@/lib/fiscal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AddHolidayForm,
  HolidayRow,
  type HolidayRowData,
} from "./holiday-client";
import {
  GenerateFiscalYearForm,
  PeriodDeleteButton,
} from "./fiscal-client";

export const metadata = { title: "Calendar Admin" };

// Delete-safety (FC-008): a period row is deletable only when no timesheet's
// week start falls in its range AND no period_close row references it. The
// flag is computed server-side; the action re-verifies before deleting.
interface PeriodRow {
  id: string;
  fiscalYear: number;
  quarter: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  weekCount: number;
  canDelete: boolean;
}

interface YearGroup {
  fiscalYear: number;
  totalWeeks: number;
  periods: PeriodRow[];
}

// Wednesday week starts inside a period's [startDate, endDate] span.
function weekStartsOfPeriod(startDate: string, weekCount: number): string[] {
  const [y, m, d] = startDate.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return Array.from(
    { length: weekCount },
    (_, i) => new Date(base + i * 7 * 86_400_000).toISOString().slice(0, 10),
  );
}

export default async function CalendarAdminPage() {
  // Server-side gate: non-admins are redirected to the dashboard.
  await requireRole(["admin"]);

  // FC-008: register DB-generated periods so week lookups resolve them
  // immediately (no caching layer — read live each request).
  await syncPeriodsFromDb();

  const [holidayRows, periodRows, filedWeeks, closeRows] = await Promise.all([
    db
      .select()
      .from(holidayTable)
      .orderBy(asc(holidayTable.observedDate)),
    db
      .select()
      .from(fiscalPeriodTable)
      .orderBy(
        asc(fiscalPeriodTable.fiscalYear),
        asc(fiscalPeriodTable.periodNumber),
      ),
    db
      .selectDistinct({ weekStartDate: timesheetTable.weekStartDate })
      .from(timesheetTable),
    db
      .select({
        fiscalYear: periodCloseTable.fiscalYear,
        periodNumber: periodCloseTable.periodNumber,
      })
      .from(periodCloseTable),
  ]);

  const filedSet = new Set(filedWeeks.map((w) => w.weekStartDate));
  const closedSet = new Set(
    closeRows.map((c) => `${c.fiscalYear}-${c.periodNumber}`),
  );

  const yearGroups: YearGroup[] = [];
  for (const row of periodRows) {
    const canDelete =
      // Timesheets are keyed by Wednesday week start, so checking every week
      // start inside the period covers the whole date range.
      weekStartsOfPeriod(row.startDate, row.weekCount).every(
        (weekStartDate) => !filedSet.has(weekStartDate),
      ) && !closedSet.has(`${row.fiscalYear}-${row.periodNumber}`);

    let group = yearGroups.at(-1);
    if (!group || group.fiscalYear !== row.fiscalYear) {
      group = {
        fiscalYear: row.fiscalYear,
        totalWeeks: 0,
        periods: [],
      };
      yearGroups.push(group);
    }
    group.periods.push({
      id: row.id,
      fiscalYear: row.fiscalYear,
      quarter: row.quarter,
      periodNumber: row.periodNumber,
      startDate: row.startDate,
      endDate: row.endDate,
      weekCount: row.weekCount,
      canDelete,
    });
    group.totalWeeks += row.weekCount;
  }

  // Generate-form defaults: the next fiscal year and its continuity-required
  // first period start (day after the previous year's last period ends).
  const latestYear =
    periodRows.length > 0
      ? periodRows[periodRows.length - 1].fiscalYear
      : null;
  const nextYear =
    latestYear !== null ? latestYear + 1 : new Date().getFullYear() + 1;
  const previousYearPeriods = periodRows.filter(
    (p) => p.fiscalYear === nextYear - 1,
  );
  // Continuity rule: FY starts the day after the previous year's P12 ends.
  const nextPeriodStart =
    previousYearPeriods.length > 0
      ? addDays(
          previousYearPeriods[previousYearPeriods.length - 1].endDate,
          1,
        )
      : weekStart(new Date(`${nextYear}-01-01T12:00:00`));

  const holidays: HolidayRowData[] = holidayRows.map((row) => ({
    id: row.id,
    name: row.name,
    observedDate: row.observedDate,
  }));

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-2 p-8">
        <p className="micro-label">Admin / FC-003 · FC-008</p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Calendar admin
        </h1>
        <p className="text-sm text-muted-foreground">
          Maintain observed holidays and future-year fiscal periods. Changes
          take effect immediately for holiday pre-population, deadlines, and
          week validation.
        </p>
      </section>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Calendar / Holidays</p>
          <CardTitle>Observed holidays</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AddHolidayForm />
          {holidays.length === 0 ? (
            <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
              <p className="micro-label">NO HOLIDAYS OBSERVED</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Observed date</TableHead>
                  <TableHead>Weekday</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((holiday) => (
                  <HolidayRow key={holiday.id} holiday={holiday} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Calendar / Fiscal Periods</p>
          <CardTitle>Generate fiscal year</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-7 text-muted-foreground">
            Generates the 12 periods of a future fiscal year using the
            company&apos;s 4-4-5 pattern (Wed–Tue weeks, 52 weeks per year).
            Periods must generate in order and start the day after the
            previous fiscal year ends.
          </p>
          <div className="mt-4">
            {/* key: remount with fresh defaults after a year is generated */}
            <GenerateFiscalYearForm
              key={nextYear}
              nextYear={nextYear}
              nextPeriodStart={nextPeriodStart}
              latestYear={latestYear}
            />
          </div>
        </CardContent>
      </Card>

      {yearGroups.length === 0 ? (
        <Card className="animate-scale-in">
          <CardContent>
            <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
              <p className="micro-label">NO FISCAL PERIODS ON RECORD</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        yearGroups.map((group) => (
          <Card key={group.fiscalYear} className="animate-scale-in">
            <CardHeader>
              <p className="micro-label">Calendar / FY{group.fiscalYear}</p>
              <CardTitle className="flex flex-wrap items-center gap-3">
                Fiscal year {group.fiscalYear}
                <Badge variant="secondary">{group.totalWeeks} weeks</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Quarter</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Weeks</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.periods.map((period) => (
                    <TableRow key={period.id}>
                      <TableCell className="font-mono text-xs">
                        P{period.periodNumber}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Q{period.quarter}
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {period.startDate}
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {period.endDate}
                      </TableCell>
                      <TableCell className="text-sm">
                        {period.weekCount}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {period.canDelete ? (
                            <PeriodDeleteButton id={period.id} />
                          ) : (
                            <span
                              className="text-xs text-muted-foreground"
                              title="Periods with filed timesheets or close records can't be deleted."
                            >
                              —
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Delete is available only for periods with no filed timesheets
                and no close records.
              </p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
