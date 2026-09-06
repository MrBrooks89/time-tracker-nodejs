import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { user as userTable } from "@/db/schema";
import { currentWeek, addWeeks, isWeekStart } from "@/lib/fiscal";
import { requireWeekEntryAccess } from "@/lib/permissions";

import {
  ensureHolidayOooEntries,
  getActiveAssignments,
  getCategories,
  getFavorites,
  getTaskCodes,
  getWeekData,
  getWeekEntriesForCorrection,
} from "@/lib/week-data";
import { Badge } from "@/components/ui/badge";
import { WeekGrid } from "./week-grid";
import { WeekAdminButtons } from "./week-admin-buttons";
import { CorrectionPanel } from "./correction-panel";
import { PartnerSelect } from "./partner-select";

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
  searchParams: Promise<{ week?: string; user?: string }>;
}) {
  // Section 1.4: requireWeekEntryAccess = requireUser + redirect for the
  // read-only roles (finance_viewer/leadership) — they have no week entry,
  // even if they type the URL directly.
  const user = await requireWeekEntryAccess();

  const params = await searchParams;

  const requested = params.week ?? currentWeek();
  if (!isWeekStart(requested)) notFound();

  // TS-021/022 delegated entry: admins may open another partner's week via
  // the `user` query param. The server never trusts this param for
  // non-admins — they are redirected before any data loads.
  let ownerUserId = user.id;
  let partnerName: string | null = null;
  if (params.user && params.user !== user.id) {
    if (user.role !== "admin") {
      redirect("/");
    }
    const [partnerRow] = await db
      .select({ id: userTable.id, name: userTable.name, isActive: userTable.isActive })
      .from(userTable)
      .where(eq(userTable.id, params.user))
      .limit(1);
    if (!partnerRow) notFound();
    ownerUserId = partnerRow.id;
    partnerName = partnerRow.name;
  }

  // FC-010: auto-populate Out of Office entries for observed holidays in
  // this week before the data load, so the grid shows them immediately.
  // Idempotent (holiday dates with any entry are skipped) and self-guarding:
  // it no-ops for non-enterable weeks and non-draft sheet states, and also
  // covers delegated admin opens (ownerUserId = target partner).
  await ensureHolidayOooEntries(ownerUserId, requested, user.id);

  const data = await getWeekData(ownerUserId, requested);
  if (!data) notFound();

  const [taskCodes, categories, assignments, favorites, adminPartners] =
    await Promise.all([
      getTaskCodes(),
      getCategories(),
      getActiveAssignments(ownerUserId),
      getFavorites(ownerUserId),
      user.role === "admin"
        ? db
            .select({ id: userTable.id, name: userTable.name })
            .from(userTable)
            .where(eq(userTable.isActive, true))
            .orderBy(asc(userTable.name))
        : Promise.resolve([]),
    ]);

  const delegated = partnerName !== null;
  const weekHref = (week: string) =>
    delegated ? `/week?week=${week}&user=${ownerUserId}` : `/week?week=${week}`;

  // TS-028 + TS-026: the correction affordance exists only for admins viewing
  // a locked week. Non-admins get no UI, and correctLockedWeek re-verifies
  // the admin role server-side.
  const canCorrect = user.role === "admin" && data.state === "locked";
  const correctionEntries = canCorrect
    ? await getWeekEntriesForCorrection(ownerUserId, requested)
    : [];

  const today = new Date().toISOString().slice(0, 10);
  const deadlinePast = data.deadline < today;

  const stateLabels: Record<string, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    submitted: "Submitted",
    in_correction: "In correction",
    approved: "Approved",
    locked: "Locked",
  };

  const nextWeek = addWeeks(requested, 1);
  const nextEnterable = data.enterable && nextWeek <= currentWeek();

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-4 p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-2">
            <p className="micro-label">
              {delegated ? `Workspace / Week / ${partnerName}` : "Workspace / My Week"}
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {delegated ? `${partnerName} — ` : ""}
              Week of {formatDateShort(data.dates[0])} – {formatDateShort(data.dates[6])}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                FY{data.week.period.fiscalYear % 100} · P{data.week.period.periodNumber} · W
                {data.week.weekIndex}
              </Badge>
              <Badge
                variant={
                  data.state === "submitted" || data.state === "approved"
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
              href={weekHref(addWeeks(requested, -1))}
              className="inline-flex h-9 items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight transition-all outline-none hover:border-primary/60 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              ‹ Prev
            </Link>
            {nextEnterable ? (
              <Link
                href={weekHref(nextWeek)}
                className="inline-flex h-9 items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight transition-all outline-none hover:border-primary/60 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Next ›
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight opacity-50">
                Next ›
              </span>
            )}
            {user.role === "admin" ? <WeekAdminButtons weekStartDate={requested} /> : null}
          </div>
        </div>
        {delegated ? (
          <div className="flex flex-col gap-1 rounded-xl border border-primary/40 bg-primary/10 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">Editing on behalf of {partnerName}</Badge>
              <Link
                href={`/week?week=${requested}`}
                className="text-sm font-bold tracking-tight text-primary underline-offset-4 hover:underline"
              >
                Back to my week
              </Link>
            </div>
            <p className="text-sm leading-relaxed text-foreground">
              Changes are saved as {partnerName} and recorded in the audit trail
              with you as the acting user.
            </p>
          </div>
        ) : null}
        {data.state === "in_correction" && data.latestRejectionNote ? (
          <div className="flex flex-col gap-1 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
            <p className="micro-label">Manager note / Action needed</p>
            <p className="text-sm leading-relaxed text-foreground">
              {data.latestRejectionNote}
            </p>
          </div>
        ) : null}
        {user.role === "admin" ? (
          <div className="max-w-sm">
            <PartnerSelect
              partners={adminPartners.filter((p) => p.id !== user.id)}
              selectedId={delegated ? ownerUserId : null}
              weekStartDate={requested}
            />
          </div>
        ) : null}
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
        targetUserId={delegated ? ownerUserId : null}
      />

      {canCorrect ? (
        <CorrectionPanel
          weekStartDate={requested}
          entries={correctionEntries}
          targetUserId={delegated ? ownerUserId : null}
        />
      ) : null}
    </div>
  );
}
