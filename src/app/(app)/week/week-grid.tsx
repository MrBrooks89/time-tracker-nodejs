"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Star, Trash2 } from "lucide-react";

import {
  copyPriorWeek,
  saveWeek,
  submitWeek,
  type SaveRow,
} from "@/lib/actions/week";
import { formatHours } from "@/lib/entry-validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type {
  AssignmentInfo,
  CategoryInfo,
  FavoriteInfo,
  TaskCodeInfo,
  WeekRow,
} from "@/lib/week-data";

interface GridRow extends SaveRow {
  key: string;
}

interface WeekGridProps {
  weekStartDate: string;
  dates: string[];
  holidaysInWeek: Array<{ name: string; date: string }>;
  rows: Array<Omit<WeekRow, "key">>;
  assignments: AssignmentInfo[];
  taskCodes: TaskCodeInfo[];
  categories: CategoryInfo[];
  favorites: FavoriteInfo[];
  state: "not_started" | "in_progress" | "submitted" | "in_correction" | "locked";
  totalHours: number;
  expectedHours: number;
  standardWeeklyHours: number;
  enterable: boolean;
}

let rowCounter = 0;
function nextKey(): string {
  rowCounter += 1;
  return `r${rowCounter}-${Date.now()}`;
}

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
  });
}

export function WeekGrid(props: WeekGridProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initialRows = useMemo(
    () => props.rows.map((row) => ({ ...row, key: nextKey() })),
    [props.rows],
  );
  const [rows, setRows] = useState<GridRow[]>(initialRows);
  const [initialKey, setInitialKey] = useState("");

  if (initialKey !== JSON.stringify(props.rows)) {
    setInitialKey(JSON.stringify(props.rows));
    setRows(props.rows.map((row) => ({ ...row, key: nextKey() })));
  }
  void initialRows;

  const locked = props.state === "locked";
  const editable = props.enterable && !locked;
  const holidayByDate = new Map(props.holidaysInWeek.map((h) => [h.date, h.name]));

  const weeklyTotal = rows.reduce(
    (sum, row) => sum + Object.values(row.days).reduce((s, h) => s + h, 0),
    0,
  );

  const variance: "met" | "below" | "over" =
    weeklyTotal < props.expectedHours - 0.001
      ? "below"
      : weeklyTotal > props.expectedHours + 0.001
        ? "over"
        : "met";

  const holidayAdjusted = props.expectedHours !== props.standardWeeklyHours;

  function updateRow(key: string, patch: Partial<GridRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function updateHours(key: string, date: string, raw: string) {
    const hours = raw === "" ? 0 : Number(raw);
    if (Number.isNaN(hours)) return;
    updateRow(key, { days: { ...rows.find((r) => r.key === key)!.days, [date]: hours } });
  }

  function addProjectRow(projectId?: string, taskCodeId?: string) {
    setRows((current) => [
      ...current,
      {
        key: nextKey(),
        projectId: projectId ?? props.assignments[0]?.projectId ?? null,
        taskCodeId: taskCodeId ?? null,
        nonProjectCategoryId: null,
        isHandsOn: false,
        note: null,
        days: {},
      },
    ]);
  }

  function addCategoryRow(categoryId?: string) {
    setRows((current) => [
      ...current,
      {
        key: nextKey(),
        projectId: null,
        taskCodeId: null,
        nonProjectCategoryId: categoryId ?? props.categories[0]?.id ?? null,
        isHandsOn: false,
        note: null,
        days: {},
      },
    ]);
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function favoriteAlreadyAdded(fav: FavoriteInfo): boolean {
    return rows.some(
      (row) =>
        row.projectId === fav.projectId &&
        row.taskCodeId === fav.taskCodeId &&
        row.nonProjectCategoryId === null,
    );
  }

  function runAction(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  }

  function handleSave() {
    runAction(() =>
      saveWeek({
        weekStartDate: props.weekStartDate,
        rows: rows.map((row) => ({
          projectId: row.projectId,
          taskCodeId: row.taskCodeId,
          nonProjectCategoryId: row.nonProjectCategoryId,
          isHandsOn: row.isHandsOn,
          note: row.note,
          days: row.days,
        })),
      }),
    );
  }

  function handleSubmit() {
    if (!window.confirm("Submit this timesheet? You can still edit it until the period closes.")) {
      return;
    }
    runAction(() => submitWeek(props.weekStartDate));
  }

  return (
    <div className="flex flex-col gap-4">
      {locked ? (
        <div className="blueprint-surface rounded-xl p-4">
          <p className="micro-label">This week is locked for reporting.</p>
        </div>
      ) : null}
      {props.state === "submitted" ? (
        <div className="blueprint-surface rounded-xl p-4">
          <p className="micro-label">
            Submitted — edits reopen this week.
          </p>
        </div>
      ) : null}
      {!props.enterable ? (
        <div className="blueprint-surface rounded-xl p-4">
          <p className="micro-label">This week isn&apos;t open for entry yet.</p>
        </div>
      ) : null}

      {props.favorites.length > 0 && editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro-label">Quick add</span>
          {props.favorites
            .filter((fav) => !favoriteAlreadyAdded(fav))
            .map((fav) => (
              <button
                key={fav.id}
                type="button"
                onClick={() => addProjectRow(fav.projectId, fav.taskCodeId)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-semibold transition-all outline-none hover:-translate-y-0.5 hover:bg-secondary/80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Star className="size-3 text-primary" />
                {fav.projectName} / {fav.taskCodeName}
              </button>
            ))}
        </div>
      ) : null}

      <div className="paper-card rounded-2xl">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-56">Project / Category</TableHead>
              {props.dates.map((date) => (
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
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={props.dates.length + 3}>
                  <div className="blueprint-surface flex items-center justify-center rounded-xl p-6">
                    <p className="micro-label">NO ROWS YET — ADD ONE BELOW</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => {
              const rowTotal = Object.values(row.days).reduce((s, h) => s + h, 0);
              const isProjectRow = row.nonProjectCategoryId === null;
              const selectedTaskCode = props.taskCodes.find(
                (tc) => tc.id === row.taskCodeId,
              );
              const showHandsOn =
                isProjectRow && selectedTaskCode?.name === "Manager Oversight";

              return (
                <TableRow key={row.key} className="hover:bg-transparent">
                  <TableCell className="align-top">
                    <div className="flex flex-col gap-2">
                      {isProjectRow ? (
                        <>
                          <Select
                            aria-label="Project"
                            value={row.projectId ?? ""}
                            disabled={!editable || isPending}
                            onChange={(e) =>
                              updateRow(row.key, {
                                projectId: e.target.value || null,
                              })
                            }
                          >
                            <option value="">Select project…</option>
                            {props.assignments.map((a) => (
                              <option key={a.projectId} value={a.projectId}>
                                #{a.projectNumber} {a.projectName}
                              </option>
                            ))}
                          </Select>
                          <Select
                            aria-label="Task code"
                            value={row.taskCodeId ?? ""}
                            disabled={!editable || isPending}
                            onChange={(e) =>
                              updateRow(row.key, {
                                taskCodeId: e.target.value || null,
                                isHandsOn: false,
                              })
                            }
                          >
                            <option value="">Select task code…</option>
                            {props.taskCodes.map((tc) => (
                              <option key={tc.id} value={tc.id}>
                                {tc.name} ·{" "}
                                {tc.classification === "capex" ? "CapEx" : "OpEx"}
                              </option>
                            ))}
                          </Select>
                          {selectedTaskCode?.notes ? (
                            <p className="max-w-64 text-xs leading-snug text-muted-foreground">
                              {selectedTaskCode.notes}
                            </p>
                          ) : null}
                          {showHandsOn ? (
                            <div className="flex flex-col gap-1 rounded-lg border border-border bg-background/30 p-2">
                              <Label className="flex items-center gap-2 text-xs font-normal">
                                <input
                                  type="checkbox"
                                  checked={row.isHandsOn}
                                  disabled={!editable || isPending}
                                  onChange={(e) =>
                                    updateRow(row.key, {
                                      isHandsOn: e.target.checked,
                                    })
                                  }
                                />
                                Hands-on capital contribution
                              </Label>
                              <p className="text-xs leading-snug text-muted-foreground">
                                Check only if this is a hands-on deliverable
                                contribution to a capital phase. Team
                                management, coaching, and financial work are
                                operating.
                              </p>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <Select
                          aria-label="Category"
                          value={row.nonProjectCategoryId ?? ""}
                          disabled={!editable || isPending}
                          onChange={(e) =>
                            updateRow(row.key, {
                              nonProjectCategoryId: e.target.value || null,
                            })
                          }
                        >
                          <option value="">Select category…</option>
                          {Object.entries(
                            props.categories.reduce<
                              Record<string, CategoryInfo[]>
                            >((acc, cat) => {
                              (acc[cat.group] ??= []).push(cat);
                              return acc;
                            }, {}),
                          ).map(([group, cats]) => (
                            <optgroup key={group} label={group}>
                              {cats.map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                  {cat.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </Select>
                      )}
                      <Input
                        aria-label="Note"
                        placeholder="Note (optional)"
                        value={row.note ?? ""}
                        disabled={!editable || isPending}
                        onChange={(e) =>
                          updateRow(row.key, { note: e.target.value || null })
                        }
                      />
                    </div>
                  </TableCell>
                  {props.dates.map((date) => {
                    const isHoliday = holidayByDate.has(date);
                    return (
                      <TableCell key={date} className="text-center align-top">
                        <Input
                          type="number"
                          step="0.25"
                          min="0"
                          aria-label={`Hours ${date}`}
                          value={row.days[date] ?? 0}
                          disabled={!editable || isPending || isHoliday}
                          onChange={(e) => updateHours(row.key, date, e.target.value)}
                          className="w-20 text-center font-mono text-sm"
                        />
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right font-mono text-sm align-top">
                    {formatHours(rowTotal)}
                  </TableCell>
                  <TableCell className="align-top">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remove row"
                      disabled={!editable || isPending}
                      onClick={() => removeRow(row.key)}
                      className="text-destructive hover:bg-destructive/15"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isPending || props.assignments.length === 0}
            onClick={() => addProjectRow()}
          >
            <Plus className="size-4" />
            Project row
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => addCategoryRow()}
          >
            <Plus className="size-4" />
            Category row
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="paper-card animate-scale-in flex items-center justify-between gap-4 rounded-2xl p-6">
          <div className="flex flex-col gap-1">
            <p className="micro-label">Week total</p>
            <p className="font-display text-4xl font-bold tracking-tight tabular-nums">
              {formatHours(weeklyTotal)}
            </p>
            <p className="text-xs text-muted-foreground">
              Expected {formatHours(props.expectedHours)}
              {holidayAdjusted ? " · holiday-adjusted" : ""}
            </p>
          </div>
          {variance === "met" ? (
            <Badge>Met standard</Badge>
          ) : variance === "below" ? (
            <Badge variant="outline">Below standard</Badge>
          ) : (
            <Badge variant="outline">Over standard</Badge>
          )}
        </div>

        <div className="flex flex-col justify-center gap-3">
          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={!editable || isPending}>
              {isPending ? "Saving…" : "Save draft"}
            </Button>
            <Button
              variant="outline"
              disabled={!editable || isPending}
              onClick={() => runAction(() => copyPriorWeek(props.weekStartDate))}
            >
              Copy prior week
            </Button>
            <Button
              disabled={!editable || isPending}
              onClick={handleSubmit}
            >
              Submit week
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
