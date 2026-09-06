import Link from "next/link";

import { requireRole } from "@/lib/permissions";
import { formatHours } from "@/lib/entry-validation";
import { getApprovalQueue } from "@/lib/week-data";
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

export const metadata = { title: "Approvals" };

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function varianceBadge(total: number, expected: number) {
  if (expected <= 0) return <Badge variant="outline">No baseline</Badge>;
  const diff = total - expected;
  if (Math.abs(diff) < 0.001) return <Badge>On standard</Badge>;
  if (diff < 0) {
    return (
      <Badge variant="outline">
        {formatHours(Math.abs(diff))} below
      </Badge>
    );
  }
  return <Badge variant="outline">{formatHours(diff)} over</Badge>;
}

export default async function ApprovalsPage() {
  const viewer = await requireRole(["admin", "manager"]);
  const queue = await getApprovalQueue(viewer);

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-2 p-8">
        <p className="micro-label">People / Approvals</p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Approval queue
        </h1>
        <p className="text-sm text-muted-foreground">
          Review submitted timesheets from your team before the period closes.
        </p>
      </section>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Queue / Awaiting decision</p>
          <CardTitle className="flex items-center gap-3">
            Pending approvals
            <Badge variant={queue.length > 0 ? "default" : "secondary"}>
              {queue.length} pending
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
              <p className="micro-label">NOTHING AWAITING YOUR APPROVAL</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Week</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((row) => (
                  <TableRow key={`${row.userId}-${row.weekStartDate}`}>
                    <TableCell className="text-sm font-medium">{row.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.team ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDateShort(row.weekStartDate)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatHours(row.totalHours)}
                    </TableCell>
                    <TableCell>{varianceBadge(row.totalHours, row.expectedHours)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDateTime(row.submittedAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDateShort(row.deadline)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/approvals/review?userId=${encodeURIComponent(row.userId)}&week=${encodeURIComponent(row.weekStartDate)}`}
                        className="inline-flex h-9 items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight transition-all outline-none hover:border-primary/60 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        Review
                      </Link>
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
