"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { addHoliday, removeHoliday, updateHoliday } from "@/lib/actions/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableCell, TableRow } from "@/components/ui/table";

export interface HolidayRowData {
  id: string;
  name: string;
  observedDate: string;
}

interface HolidayFormProps {
  holiday?: HolidayRowData;
  onCancel?: () => void;
}

// Add/update form: no holiday → create; with holiday → edit (follows the
// employee form's transition + error pattern).
export function HolidayForm({ holiday, onCancel }: HolidayFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "");
    const observedDate = String(formData.get("observedDate") ?? "");
    setError(null);
    startTransition(async () => {
      const result = holiday
        ? await updateHoliday(holiday.id, name, observedDate)
        : await addHoliday(name, observedDate);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
      onCancel?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`holiday-name-${holiday?.id ?? "new"}`}>Name</Label>
          <Input
            id={`holiday-name-${holiday?.id ?? "new"}`}
            name="name"
            type="text"
            required
            placeholder="e.g. Founder's Day"
            defaultValue={holiday?.name ?? ""}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`holiday-date-${holiday?.id ?? "new"}`}>
            Observed date
          </Label>
          <Input
            id={`holiday-date-${holiday?.id ?? "new"}`}
            name="observedDate"
            type="date"
            required
            defaultValue={holiday?.observedDate ?? ""}
            disabled={isPending}
          />
        </div>
      </div>
      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={isPending}>
          {holiday ? "Save changes" : "Add holiday"}
        </Button>
      </div>
    </form>
  );
}

export function AddHolidayForm() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>Add holiday</Button>
      </div>
    );
  }

  return (
    <div className="animate-scale-in flex flex-col gap-4 rounded-2xl border border-border bg-background/30 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]">
      <p className="micro-label">Calendar / New Holiday</p>
      <HolidayForm onCancel={() => setOpen(false)} />
    </div>
  );
}

// Table row with remove + inline edit, mirroring the employee row pattern.
export function HolidayRow({ holiday }: { holiday: HolidayRowData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeHoliday(holiday.id);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <TableRow>
        <TableCell className="text-sm font-medium">{holiday.name}</TableCell>
        <TableCell className="font-mono text-xs whitespace-nowrap">
          {holiday.observedDate}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
          {weekdayLabel(holiday.observedDate)}
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={editing}
              disabled={isPending}
              onClick={() => setEditing((value) => !value)}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={handleRemove}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {error ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="text-sm font-medium text-destructive">
            {error}
          </TableCell>
        </TableRow>
      ) : null}
      {editing ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="border-b-0 p-0">
            <div className="animate-scale-in flex flex-col gap-4 border-l-2 border-primary/50 bg-background/30 px-4 py-4 backdrop-blur-sm">
              <p className="micro-label">Calendar / Edit Holiday</p>
              <HolidayForm
                holiday={holiday}
                onCancel={() => setEditing(false)}
              />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function weekdayLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}
