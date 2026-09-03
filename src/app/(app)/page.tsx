import Link from "next/link";

import { currentWeek } from "@/lib/fiscal";
import { canManagePeople } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import {
  getComplianceSnapshot,
  getOwnOutstandingWeeks,
  getWeekData,
} from "@/lib/week-data";
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
import { SignOutButton } from "@/components/sign-out-button";

export const metadata = { title: "Time Tracker" };

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
  });
}

const stateLabels: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  in_correction: "In correction",
  locked: "Locked",
};

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.name.split(" ")[0];
  const manage = canManagePeople(user.role);

  const week = currentWeek();
  const [weekData, outstanding, compliance] = await Promise.all([
    getWeekData(user.id, week),
    getOwnOutstandingWeeks(user.id),
    manage ? getComplianceSnapshot(4) : Promise.resolve([]),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const deadlinePast = weekData ? weekData.deadline < today : false;

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-6 p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="micro-label">Time Tracking / Command Deck</p>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Welcome back, {firstName}
            </h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge>{user.role}</Badge>
            <SignOutButton />
          </div>
        </div>
        <div>
          <Link
            href="/week"
            className="command-strip inline-flex h-10 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-bold tracking-tight text-primary-foreground shadow-[0_10px_32px_-12px_var(--primary)] outline-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_38px_-12px_var(--primary)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Open my week
          </Link>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
          <p className="micro-label">Current week</p>
          <p className="font-display text-2xl font-bold tracking-tight">
            {weekData
              ? `${formatHoursSafe(weekData.totalHours)} / ${formatHoursSafe(weekData.expectedHours)}`
              : "—"}
          </p>
          <Badge variant={weekData?.state === "submitted" ? "default" : "secondary"}>
            {weekData ? (stateLabels[weekData.state] ?? weekData.state) : "Not started"}
          </Badge>
          <p className="text-xs text-muted-foreground">
            Week of {weekData ? formatDateShort(weekData.weekStartDate) : ""}
          </p>
        </div>

        <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
          <p className="micro-label">Submission deadline</p>
          <p className="font-display text-2xl font-bold tracking-tight">
            {weekData ? formatDateLong(weekData.deadline).replace(/,.*/, "") : "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            {weekData ? formatDateLong(weekData.deadline) : ""}
            {deadlinePast ? " · past due" : ""}
          </p>
        </div>

        <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
          <p className="micro-label">Outstanding weeks</p>
          <p className="font-display text-2xl font-bold tracking-tight">
            {outstanding.length}
          </p>
          {outstanding.length === 0 ? (
            <Badge>All caught up</Badge>
          ) : (
            <Badge variant="destructive">
              {outstanding.length} unsubmitted
            </Badge>
          )}
          {outstanding.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Weeks due: {outstanding.map((w) => formatDateShort(w.weekStartDate)).join(", ")}
            </p>
          ) : null}
        </div>
      </div>

      {manage ? (
        <Card className="animate-scale-in">
          <CardHeader>
            <p className="micro-label">Compliance / Attention</p>
            <CardTitle className="flex items-center gap-3">
              Unsubmitted timesheets
              <Badge variant="secondary">{compliance.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {compliance.length === 0 ? (
              <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
                <p className="micro-label">ALL CAUGHT UP</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Week</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Deadline</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {compliance.slice(0, 20).map((row) => (
                    <TableRow key={`${row.userId}-${row.weekStartDate}`}>
                      <TableCell className="text-sm font-medium">{row.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.team ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDateShort(row.weekStartDate)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {stateLabels[row.state] ?? row.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDateShort(row.deadline)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function formatHoursSafe(hours: number): string {
  const rounded = Math.round(hours * 4) / 4;
  const formatted = Number.isInteger(rounded)
    ? String(rounded)
    : String(Number(rounded.toFixed(2)));
  return `${formatted}h`;
}
