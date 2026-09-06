import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Download } from "lucide-react";

import { db } from "@/db";
import {
  holiday as holidayTable,
  periodClose as periodCloseTable,
  timeEntry as timeEntryTable,
  timesheet as timesheetTable,
  user as userTable,
} from "@/db/schema";
import { exceptionFlags, weeksOfPeriod } from "@/lib/close";
import { HOURS_TOLERANCE } from "@/lib/config";
import { FISCAL_PERIODS, type FiscalPeriodInfo } from "@/lib/fiscal";
import { expectedHours } from "@/lib/holidays";
import { requireRole } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CloseActions } from "./close-actions";

export const metadata = { title: "Period Close" };

const stateLabels: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  in_correction: "In correction",
  approved: "Approved",
  locked: "Locked",
};

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 4) / 4;
  const formatted = Number.isInteger(rounded)
    ? String(rounded)
    : String(Number(rounded.toFixed(2)));
  return `${formatted}h`;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface ExceptionRow {
  userId: string;
  name: string;
  team: string | null;
  weekStartDate: string;
  state: string;
  totalHours: number;
  expectedHours: number;
  flags: string[];
}

type SheetState =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "in_correction"
  | "approved"
  | "locked";

async function loadCloseData(period: FiscalPeriodInfo) {
  const weeks = weeksOfPeriod(period);

  const [holidayDates, closeRow] = await Promise.all([
    db
      .select({ date: holidayTable.observedDate })
      .from(holidayTable)
      .then((rows) => rows.map((h) => h.date)),
    db
      .select()
      .from(periodCloseTable)
      .where(
        and(
          eq(periodCloseTable.fiscalYear, period.fiscalYear),
          eq(periodCloseTable.periodNumber, period.periodNumber),
        ),
      )
      .limit(1),
  ]);

  const [users, sheets] = await Promise.all([
    db
      .select({
        id: userTable.id,
        name: userTable.name,
        team: userTable.team,
        standardWeeklyHours: userTable.standardWeeklyHours,
      })
      .from(userTable)
      .where(eq(userTable.isActive, true))
      .orderBy(asc(userTable.name)),
    db
      .select({
        id: timesheetTable.id,
        userId: timesheetTable.userId,
        weekStartDate: timesheetTable.weekStartDate,
        state: timesheetTable.state,
        totalHours: sql<number>`coalesce(sum(${timeEntryTable.hours}), 0)`,
      })
      .from(timesheetTable)
      .leftJoin(
        timeEntryTable,
        eq(timeEntryTable.timesheetId, timesheetTable.id),
      )
      .where(inArray(timesheetTable.weekStartDate, weeks))
      .groupBy(timesheetTable.id),
  ]);

  const sheetByUserWeek = new Map(
    sheets.map((s) => [`${s.userId}|${s.weekStartDate}`, s]),
  );

  const rows: ExceptionRow[] = [];
  for (const user of users) {
    for (const week of weeks) {
      const sheet = sheetByUserWeek.get(`${user.id}|${week}`);
      const state: SheetState = sheet?.state ?? "not_started";
      const totalHours = sheet ? Number(sheet.totalHours ?? 0) : 0;
      const expected = expectedHours(
        week,
        user.standardWeeklyHours,
        holidayDates,
      );
      const { flags } = exceptionFlags(
        {
          userId: user.id,
          state,
          totalHours,
          expectedHours: expected,
        },
        HOURS_TOLERANCE,
      );
      rows.push({
        userId: user.id,
        name: user.name,
        team: user.team,
        weekStartDate: week,
        state,
        totalHours,
        expectedHours: expected,
        flags,
      });
    }
  }

  return { rows, close: closeRow[0] ?? null };
}

export default async function ClosePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  await requireRole(["admin"]);
  const params = await searchParams;

  const today = new Date().toISOString().slice(0, 10);
  const eligible = FISCAL_PERIODS.filter((p) => p.endDate < today);

  if (eligible.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <section className="glass-panel animate-fade-up flex flex-col gap-2 p-8">
          <p className="micro-label">Close / Period Console</p>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Period close
          </h1>
        </section>
        <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
          <p className="micro-label">NO COMPLETED PERIODS YET</p>
        </div>
      </div>
    );
  }

  const requested = FISCAL_PERIODS.find(
    (p) =>
      p.fiscalYear === Number(params.year) &&
      p.periodNumber === Number(params.period),
  );
  const selected =
    requested && requested.endDate < today
      ? requested
      : eligible[eligible.length - 1];

  const { rows, close } = await loadCloseData(selected);

  // Flagged rows first so the admin scans exceptions before settled sheets.
  const sorted = [...rows].sort((a, b) => {
    if (a.flags.length > 0 && b.flags.length === 0) return -1;
    if (a.flags.length === 0 && b.flags.length > 0) return 1;
    return 0;
  });

  const flagged = sorted.filter((r) => r.flags.length > 0);
  const unsubmittedCount = flagged.filter((r) =>
    r.flags.includes("unsubmitted"),
  ).length;
  const outlierCount = flagged.filter((r) =>
    r.flags.includes("hours_outlier"),
  ).length;

  const status: "open" | "window" | "closed" = !close
    ? "open"
    : close.closedAt !== null
      ? "closed"
      : "window";

  const windowEndsAt = close?.correctionWindowEndsAt ?? null;
  const windowElapsed =
    windowEndsAt === null || new Date() >= windowEndsAt;
  const awaiting = sorted.filter((r) => r.state === "submitted").length;
  const inCorrection = sorted.filter((r) => r.state === "in_correction").length;
  const canFinalize = windowElapsed || (awaiting === 0 && inCorrection === 0);

  const closedById = close?.closedBy ?? null;
  const closedByName = closedById
    ? ((await db
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, closedById))
        .limit(1))[0]?.name ?? null)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-4 p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-2">
            <p className="micro-label">Close / Period Console</p>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Period close
            </h1>
            <p className="text-sm text-muted-foreground">
              FY{selected.fiscalYear} P{selected.periodNumber} ·{" "}
              {formatDateShort(selected.startDate)} –{" "}
              {formatDateShort(selected.endDate)} · {selected.weekCount} weeks
            </p>
          </div>
          <form method="get" action="/close" className="flex items-end gap-3">
            <div className="flex w-32 flex-col gap-2">
              <Label htmlFor="close-year">Fiscal year</Label>
              <Select
                id="close-year"
                name="year"
                defaultValue={String(selected.fiscalYear)}
              >
                {[...new Set(eligible.map((p) => p.fiscalYear))].map((y) => (
                  <option key={y} value={y}>
                    FY{y}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex w-24 flex-col gap-2">
              <Label htmlFor="close-period">Period</Label>
              <Select
                id="close-period"
                name="period"
                defaultValue={String(selected.periodNumber)}
              >
                {eligible
                  .filter((p) => p.fiscalYear === selected.fiscalYear)
                  .map((p) => (
                    <option key={p.periodNumber} value={p.periodNumber}>
                      P{p.periodNumber}
                    </option>
                  ))}
              </Select>
            </div>
            <button
              type="submit"
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-border bg-secondary/40 px-5 text-sm font-bold tracking-tight text-foreground backdrop-blur-sm transition-all duration-200 outline-none hover:-translate-y-0.5 hover:border-primary/60 hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              View
            </button>
          </form>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
          <p className="micro-label">Close status</p>
          <p className="font-display text-2xl font-bold tracking-tight">
            {status === "open"
              ? "Open"
              : status === "window"
                ? "Correction window"
                : "Closed"}
          </p>
          {status === "window" && windowEndsAt ? (
            <p className="text-xs text-muted-foreground">
              Window ends {formatTimestamp(windowEndsAt)}
            </p>
          ) : null}
          {close?.closedAt ? (
            <p className="text-xs text-muted-foreground">
              Closed {formatTimestamp(close.closedAt)}
              {closedByName ? ` by ${closedByName}` : ""}
            </p>
          ) : null}
        </div>
        <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
          <p className="micro-label">Flagged sheets</p>
          <p className="font-display text-2xl font-bold tracking-tight">
            {flagged.length}
          </p>
          <p className="text-xs text-muted-foreground">
            {unsubmittedCount} unsubmitted · {outlierCount} hours outlier
          </p>
        </div>
        <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
          <p className="micro-label">Awaiting approval</p>
          <p className="font-display text-2xl font-bold tracking-tight">
            {awaiting}
          </p>
          <p className="text-xs text-muted-foreground">submitted, pending review</p>
        </div>
        <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
          <p className="micro-label">In correction</p>
          <p className="font-display text-2xl font-bold tracking-tight">
            {inCorrection}
          </p>
          <p className="text-xs text-muted-foreground">mid-fix, resubmit pending</p>
        </div>
      </div>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Close / Actions</p>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            FY{selected.fiscalYear} P{selected.periodNumber} actions
            <CloseActions
              fiscalYear={selected.fiscalYear}
              periodNumber={selected.periodNumber}
              status={status}
              outlierCount={outlierCount}
              gate={{
                canFinalize,
                awaiting,
                inCorrection,
                windowEndsAt: windowEndsAt
                  ? formatTimestamp(windowEndsAt)
                  : null,
              }}
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status === "open" ? (
            <p className="text-sm text-muted-foreground">
              Initiating the close opens a correction window and sends flagged
              outlier sheets back to their partners for correction.
            </p>
          ) : status === "window" ? (
            <p className="text-sm text-muted-foreground">
              Finalizing locks every timesheet in the period. Unsubmitted weeks
              lock as-is; the period closes regardless.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              This period is closed. Reopening restores locked sheets to their
              prior states from approval and submission evidence.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Close / Exception Report</p>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-3">
              Pre-close exceptions
              <Badge variant="secondary">{flagged.length} flagged</Badge>
            </span>
            <div className="flex items-center gap-2">
              <a
                href={`/close/export?year=${selected.fiscalYear}&period=${selected.periodNumber}&format=csv`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight text-foreground backdrop-blur-sm transition-all duration-200 outline-none hover:-translate-y-0.5 hover:border-accent/60 hover:text-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Download className="size-4" />
                Export CSV
              </a>
              <a
                href={`/close/export?year=${selected.fiscalYear}&period=${selected.periodNumber}&format=xlsx`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight text-foreground backdrop-blur-sm transition-all duration-200 outline-none hover:-translate-y-0.5 hover:border-primary/60 hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Download className="size-4" />
                Export XLSX
              </a>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sorted.length === 0 ? (
            <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
              <p className="micro-label">NO TIMESHEETS IN PERIOD</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Week</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => (
                  <TableRow key={`${row.userId}-${row.weekStartDate}`}>
                    <TableCell className="text-sm font-medium">
                      {row.name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.team ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDateShort(row.weekStartDate)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.state === "submitted"
                            ? "default"
                            : row.state === "locked"
                              ? "outline"
                              : "secondary"
                        }
                      >
                        {stateLabels[row.state] ?? row.state}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatHours(row.totalHours)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatHours(row.expectedHours)}
                    </TableCell>
                    <TableCell>
                      {row.flags.length === 0 ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {row.flags.includes("unsubmitted") ? (
                            <Badge variant="destructive">Unsubmitted</Badge>
                          ) : null}
                          {row.flags.includes("hours_outlier") ? (
                            <Badge variant="destructive">Hours outlier</Badge>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
