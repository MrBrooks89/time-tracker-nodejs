"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Trash2 } from "lucide-react";

import {
  deleteFiscalPeriod,
  generateFiscalYear,
} from "@/lib/actions/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface GenerateFiscalYearFormProps {
  // Defaults computed server-side: the next year to generate and its
  // continuity-required first period start (previous year's last end + 1).
  nextYear: number;
  nextPeriodStart: string;
  latestYear: number | null;
}

export function GenerateFiscalYearForm({
  nextYear,
  nextPeriodStart,
  latestYear,
}: GenerateFiscalYearFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const year = Number(formData.get("year"));
    const firstPeriodStart = String(formData.get("firstPeriodStart") ?? "");
    setError(null);
    startTransition(async () => {
      const result = await generateFiscalYear(year, firstPeriodStart);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fiscal-year">Fiscal year</Label>
          <Input
            id="fiscal-year"
            name="year"
            type="number"
            required
            min={2000}
            max={2200}
            defaultValue={nextYear}
            disabled={isPending}
          />
          {latestYear !== null ? (
            <p className="text-xs text-muted-foreground">
              Years generate in order — next up is FY{nextYear}.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fiscal-period-start">First period start</Label>
          <Input
            id="fiscal-period-start"
            name="firstPeriodStart"
            type="date"
            required
            defaultValue={nextPeriodStart}
            disabled={isPending}
          />
          <p className="text-xs text-muted-foreground">
            Must be a Wednesday — the day after the previous fiscal year ends.
          </p>
        </div>
      </div>
      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          <CalendarPlus className="size-4" />
          Generate FY{nextYear} periods
        </Button>
      </div>
    </form>
  );
}

export function PeriodDeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteFiscalPeriod(id);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={handleDelete}
      >
        <Trash2 className="size-4" />
        Delete
      </Button>
      {error ? (
        <span className="text-xs font-medium text-destructive">{error}</span>
      ) : null}
    </div>
  );
}
