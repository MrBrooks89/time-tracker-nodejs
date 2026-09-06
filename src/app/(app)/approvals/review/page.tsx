import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { and, eq, isNull, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { user as userTable } from "@/db/schema";
import { canApprove } from "@/lib/approval";
import { isWeekStart } from "@/lib/fiscal";
import { requireRole } from "@/lib/permissions";
import { getCategories, getTaskCodes, getWeekData } from "@/lib/week-data";
import { formatHours } from "@/lib/entry-validation";
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
import { ReviewActions } from "./review-actions";

export const metadata = { title: "Review Timesheet" };

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateLong(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
  });
}

// Same eligibility rules as the queue (D2/D3): the viewer must be the
// effective approver for this partner, and never the sheet owner.
async function loadEligibleTarget(
  viewer: { id: string; role: "admin" | "manager" | "employee" },
  userId: string,
): Promise<{ managerId: string | null } | null> {
  const ownerFilter =
    viewer.role === "admin"
      ? or(
          eq(userTable.managerId, viewer.id),
          isNull(userTable.managerId),
          eq(userTable.managerId, userTable.id),
        )
      : eq(userTable.managerId, viewer.id);

  const [target] = await db
    .select({ id: userTable.id, managerId: userTable.managerId })
    .from(userTable)
    .where(
      and(eq(userTable.id, userId), ne(userTable.id, viewer.id), ownerFilter),
    )
    .limit(1);
  return target ?? null;
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; week?: string }>;
}) {
  const viewer = await requireRole(["admin", "manager"]);
  const params = await searchParams;

  const userId = params.userId ?? "";
  const week = params.week ?? "";
  if (!userId || !week || !isWeekStart(week)) {
    redirect("/approvals");
  }

  const target = await loadEligibleTarget(viewer, userId);
  if (!target) {
    redirect("/approvals");
  }

  const data = await getWeekData(userId, week);
  if (!data) notFound();

  // Final gate: the Phase B rule with the real sheet state (e.g. a sheet
  // already decided drops out of "submitted" and the buttons disappear).
  const sheetState = data.state;
  const approvable = canApprove(
    sheetState,
    viewer.role,
    viewer.id,
    userId,
    target.managerId,
  );

  const [ownerRows, taskCodes, categories] = await Promise.all([
    db
      .select({ name: userTable.name, team: userTable.team })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1),
    getTaskCodes(),
    getCategories(),
  ]);
  const owner = ownerRows[0];

  const holidayByDate = new Map(data.holidaysInWeek.map((h) => [h.date, h.name]));
  const variance = data.totalHours - data.expectedHours;
  const holidayAdjusted = data.expectedHours !== data.standardWeeklyHours;
  const taskCodeNameById = new Map(taskCodes.map((c) => [c.id, c.name]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-4 p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-2">
            <p className="micro-label">People / Approval Review</p>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {owner?.name ?? "Partner"} · Week of {formatDateShort(data.dates[0])}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                FY{data.week.period.fiscalYear % 100} · P{data.week.period.periodNumber} · W
                {data.week.weekIndex}
              </Badge>
              {owner?.team ? <Badge variant="outline">{owner.team}</Badge> : null}
              <Badge
                variant={
                  sheetState === "submitted" || sheetState === "approved"
                    ? "default"
                    : sheetState === "locked"
                      ? "outline"
                      : "secondary"
                }
              >
                {sheetState.replace("_", " ")}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Due {formatDateLong(data.deadline)}
              </span>
            </div>
          </div>
          <Link
            href="/approvals"
            className="inline-flex h-9 items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight transition-all outline-none hover:border-primary/60 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            ‹ Back to queue
          </Link>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
          <p className="micro-label">Total hours</p>
          <p className="font-display text-2xl font-bold tracking-tight">
            {formatHours(data.totalHours)}
          </p>
          <p className="text-xs text-muted-foreground">
            Expected {formatHours(data.expectedHours)}
            {holidayAdjusted ? " · holiday-adjusted" : ""}
          </p>
        </div>
        <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
          <p className="micro-label">Variance</p>
          <p className="font-display text-2xl font-bold tracking-tight">
            {variance > 0 ? "+" : ""}
            {formatHours(variance)}
          </p>
          {data.expectedHours <= 0 ? (
            <Badge variant="outline">No baseline</Badge>
          ) : Math.abs(variance) < 0.001 ? (
            <Badge>On standard</Badge>
          ) : variance < 0 ? (
            <Badge variant="outline">Below standard</Badge>
          ) : (
            <Badge variant="outline">Over standard</Badge>
          )}
        </div>
        <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
          <p className="micro-label">Submitted</p>
          <p className="font-display text-2xl font-bold tracking-tight">
            {data.submittedAt ? formatDateShort(data.submittedAt.slice(0, 10)) : "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            {data.holidaysInWeek.length > 0
              ? `Holiday: ${data.holidaysInWeek.map((h) => h.name).join(", ")}`
              : "No holidays this week"}
          </p>
        </div>
      </div>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Entries / Read-only</p>
          <CardTitle>Submitted hours</CardTitle>
        </CardHeader>
        <CardContent>
          {data.rows.length === 0 ? (
            <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
              <p className="micro-label">NO ENTRIES RECORDED</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56">Project / Category</TableHead>
                  {data.dates.map((date) => (
                    <TableHead key={date} className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span>{dayLabel(date)}</span>
                        {holidayByDate.has(date) ? (
                          <Badge variant="outline">{holidayByDate.get(date)}</Badge>
                        ) : null}
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => {
                  const rowTotal = Object.values(row.days).reduce((s, h) => s + h, 0);
                  const label = row.projectId
                    ? data.rowProjectNames[row.projectId] ?? "Unknown project"
                    : row.nonProjectCategoryId
                      ? categoryNameById.get(row.nonProjectCategoryId) ?? "Non-project"
                      : "—";
                  const subLabel = row.taskCodeId
                    ? taskCodeNameById.get(row.taskCodeId) ?? null
                    : null;
                  return (
                    <TableRow key={row.key} className="hover:bg-transparent">
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium">{label}</span>
                          {subLabel ? (
                            <span className="text-xs text-muted-foreground">
                              {subLabel}
                              {row.isHandsOn ? " · hands-on" : ""}
                            </span>
                          ) : null}
                          {row.note ? (
                            <span className="max-w-64 text-xs leading-snug text-muted-foreground">
                              {row.note}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      {data.dates.map((date) => (
                        <TableCell key={date} className="text-center font-mono text-sm">
                          {row.days[date] ? formatHours(row.days[date]) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-mono text-sm">
                        {formatHours(rowTotal)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {approvable ? (
        <ReviewActions userId={userId} weekStartDate={week} />
      ) : (
        <div className="blueprint-surface rounded-xl p-4">
          <p className="micro-label">
            This timesheet is not awaiting a decision.
          </p>
        </div>
      )}
    </div>
  );
}
