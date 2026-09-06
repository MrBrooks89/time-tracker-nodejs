import Link from "next/link";
import { desc } from "drizzle-orm";

import { reminderLog as reminderLogTable } from "@/db/schema";
import { requireRole } from "@/lib/permissions";
import {
  getOutstandingReminders,
  isDeadlineDay,
  loadHolidayDates,
  reminderHistoryQuery,
} from "@/lib/reminders";
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
import { RemindersTable, type OutstandingRow } from "./reminders-client";

export const metadata = { title: "Reminders" };

const HISTORY_LIMIT = 50;

export default async function RemindersPage() {
  // Server-side gate: non-admins are redirected to the dashboard (TS-019).
  await requireRole(["admin"]);

  const [rows, holidays, history] = await Promise.all([
    getOutstandingReminders(),
    loadHolidayDates(),
    reminderHistoryQuery()
      .orderBy(desc(reminderLogTable.remindedAt))
      .limit(HISTORY_LIMIT),
  ]);

  const outstanding: OutstandingRow[] = rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    weekStartDate: row.weekStartDate,
    deadline: row.deadline,
    daysOverdue: row.daysOverdue,
    state: row.state,
    lastRemindedAt: row.lastRemindedAt ? row.lastRemindedAt.toISOString() : null,
  }));

  const deadlineDay = await isDeadlineDay(holidays);

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-2 p-8">
        <p className="micro-label">Compliance / TS-019 · TS-020</p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Reminders
        </h1>
        <p className="text-sm text-muted-foreground">
          Partners with unsubmitted timesheets whose deadline has arrived,
          derived from the fiscal calendar and observed holidays — no scheduler,
          in-app records only.
        </p>
      </section>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Reminders / Outstanding</p>
          <CardTitle className="flex flex-wrap items-center gap-3">
            Outstanding timesheets
            <Badge variant={outstanding.length > 0 ? "default" : "secondary"}>
              {outstanding.length} outstanding
            </Badge>
            {deadlineDay ? (
              <Badge>Deadline day</Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {deadlineDay ? (
            <p className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
              Today is a timesheet deadline day — unsubmitted weeks are now due
              or overdue.
            </p>
          ) : null}
          {outstanding.length === 0 ? (
            <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
              <p className="micro-label">NO OUTSTANDING TIMESHEETS</p>
            </div>
          ) : (
            <RemindersTable rows={outstanding} />
          )}
        </CardContent>
      </Card>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Reminders / History</p>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            Reminder history
            <Link
              href="/reminders/export"
              className="inline-flex h-9 items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight transition-all outline-none hover:border-primary/60 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Export CSV
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
              <p className="micro-label">NO REMINDERS SENT YET</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Week</TableHead>
                  <TableHead>Reminded by</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm font-medium">
                      {row.userName}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.weekStartDate}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.remindedByName}
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {row.remindedAt.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.note ?? "—"}
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
