import Link from "next/link";
import { notFound } from "next/navigation";

import { currentWeek, addWeeks, isWeekStart } from "@/lib/fiscal";
import { canManagePeople } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import {
  getActiveAssignments,
  getCategories,
  getFavorites,
  getTaskCodes,
  getWeekData,
} from "@/lib/week-data";
import { Badge } from "@/components/ui/badge";
import { WeekGrid } from "./week-grid";
import { WeekAdminButtons } from "./week-admin-buttons";

export const metadata = { title: "My Week" };

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

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const requested = params.week ?? currentWeek();
  if (!isWeekStart(requested)) notFound();

  const data = await getWeekData(user.id, requested);
  if (!data) notFound();

  const [taskCodes, categories, assignments, favorites] = await Promise.all([
    getTaskCodes(),
    getCategories(),
    getActiveAssignments(user.id),
    getFavorites(user.id),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const deadlinePast = data.deadline < today;

  const stateLabels: Record<string, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    submitted: "Submitted",
    in_correction: "In correction",
    locked: "Locked",
  };

  const nextWeek = addWeeks(requested, 1);
  const nextEnterable = data.enterable && nextWeek <= currentWeek();
  const isManager = canManagePeople(user.role);

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-4 p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-2">
            <p className="micro-label">Workspace / My Week</p>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Week of {formatDateShort(data.dates[0])} – {formatDateShort(data.dates[6])}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                FY{data.week.period.fiscalYear % 100} · P{data.week.period.periodNumber} · W
                {data.week.weekIndex}
              </Badge>
              <Badge
                variant={
                  data.state === "submitted"
                    ? "default"
                    : data.state === "locked"
                      ? "outline"
                      : "secondary"
                }
              >
                {stateLabels[data.state] ?? data.state}
              </Badge>
              <span
                className={
                  deadlinePast
                    ? "text-sm font-medium text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                Due {formatDateLong(data.deadline)}
                {deadlinePast ? " (past due)" : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/week?week=${addWeeks(requested, -1)}`}
              className="inline-flex h-9 items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight transition-all outline-none hover:border-primary/60 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              ‹ Prev
            </Link>
            {nextEnterable ? (
              <Link
                href={`/week?week=${nextWeek}`}
                className="inline-flex h-9 items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight transition-all outline-none hover:border-primary/60 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Next ›
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight opacity-50">
                Next ›
              </span>
            )}
            {isManager ? <WeekAdminButtons weekStartDate={requested} /> : null}
          </div>
        </div>
      </section>

      <WeekGrid
        weekStartDate={requested}
        dates={data.dates}
        holidaysInWeek={data.holidaysInWeek}
        rows={data.rows.map((row) => ({
          projectId: row.projectId,
          taskCodeId: row.taskCodeId,
          nonProjectCategoryId: row.nonProjectCategoryId,
          isHandsOn: row.isHandsOn,
          note: row.note,
          days: row.days,
        }))}
        assignments={assignments}
        taskCodes={taskCodes}
        categories={categories}
        favorites={favorites}
        state={data.state}
        totalHours={data.totalHours}
        expectedHours={data.expectedHours}
        standardWeeklyHours={data.standardWeeklyHours}
        enterable={data.enterable}
      />
    </div>
  );
}
