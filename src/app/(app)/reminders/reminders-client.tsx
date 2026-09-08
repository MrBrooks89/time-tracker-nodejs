"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";

import { sendReminders } from "@/lib/actions/reminders";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface OutstandingRow {
  userId: string;
  name: string;
  email: string;
  weekStartDate: string;
  deadline: string;
  daysOverdue: number;
  state: string;
  lastRemindedAt: string | null;
}

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function overdueLabel(days: number): string {
  if (days === 0) return "Due today";
  return `${days} day${days === 1 ? "" : "s"} over`;
}

export function RemindersTable({ rows }: { rows: OutstandingRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const allKeys = useMemo(
    () => rows.map((r) => `${r.userId}|${r.weekStartDate}`),
    [rows],
  );
  const [checked, setChecked] = useState(new Set<string>());

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function parseTargets(set: Set<string>) {
    return [...set].map((key) => {
      const [userId, weekStartDate] = key.split("|");
      return { userId, weekStartDate };
    });
  }

  function run(targets: "all" | { userId: string; weekStartDate: string }[]) {
    startTransition(async () => {
      const result = await sendReminders(targets);
      if (!result.ok) {
        window.alert(result.error ?? "Could not send reminders.");
        return;
      }
      if (result.sent === 0) {
        window.alert(
          result.error ?? "Nothing left to remind — the list may have changed.",
        );
      } else if (result.failed > 0) {
        window.alert(result.error ?? "Some reminders failed to send.");
      }
      setChecked(new Set());
      router.refresh();
    });
  }

  function handleRemindSelected() {
    if (checked.size === 0) return;
    if (
      window.confirm(
        `Send reminders for ${checked.size} outstanding timesheet${checked.size === 1 ? "" : "s"}?`,
      )
    ) {
      run(parseTargets(checked));
    }
  }

  function handleRemindAll() {
    if (rows.length === 0) return;
    if (
      window.confirm(
        `Send reminders for all ${rows.length} outstanding timesheets?`,
      )
    ) {
      run("all");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="default"
          size="sm"
          onClick={handleRemindSelected}
          disabled={isPending || checked.size === 0}
        >
          <BellRing className="size-4" />
          Remind selected ({checked.size})
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRemindAll}
          disabled={isPending || rows.length === 0}
        >
          Remind all
        </Button>
        <button
          type="button"
          onClick={() =>
            setChecked(
              checked.size === allKeys.length ? new Set() : new Set(allKeys),
            )
          }
          className="text-sm font-semibold text-muted-foreground transition-colors outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {checked.size === allKeys.length && allKeys.length > 0
            ? "Clear all"
            : "Select all"}
        </button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                aria-label="Select all outstanding timesheets"
                checked={checked.size === allKeys.length && allKeys.length > 0}
                onChange={() =>
                  setChecked(
                    checked.size === allKeys.length
                      ? new Set()
                      : new Set(allKeys),
                  )
                }
                className="size-4 cursor-pointer accent-[var(--primary)]"
              />
            </TableHead>
            <TableHead>Partner</TableHead>
            <TableHead>Week</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Last reminded</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const key = `${row.userId}|${row.weekStartDate}`;
            const isChecked = checked.has(key);
            return (
              <TableRow
                key={key}
                className={
                  row.daysOverdue > 0 ? "bg-destructive/5" : undefined
                }
              >
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Remind ${row.name} for week of ${row.weekStartDate}`}
                    checked={isChecked}
                    onChange={() => toggle(key)}
                    className="size-4 cursor-pointer accent-[var(--primary)]"
                  />
                </TableCell>
                <TableCell>
                  <span className="block text-sm font-medium">{row.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {row.email}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {formatDateShort(row.weekStartDate)}
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  <span
                    className={
                      row.daysOverdue > 0
                        ? "font-semibold text-destructive"
                        : "font-semibold text-primary"
                    }
                  >
                    {formatDateShort(row.deadline)}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {overdueLabel(row.daysOverdue)}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.state.replace("_", " ")}
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {formatDateTime(row.lastRemindedAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
