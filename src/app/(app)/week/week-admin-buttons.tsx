"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarCheck, LockOpen } from "lucide-react";

import { findWeek } from "@/lib/fiscal";
import { reopenPeriod } from "@/lib/actions/close";
import { Button } from "@/components/ui/button";

export function WeekAdminButtons({ weekStartDate }: { weekStartDate: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const week = findWeek(weekStartDate);
  const periodLabel = week
    ? `FY${week.period.fiscalYear} P${week.period.periodNumber}`
    : "this period";

  function handleReopen() {
    if (!week) return;
    if (
      !window.confirm(
        `Reopen ${periodLabel}? Locked timesheets return to their prior states.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await reopenPeriod(
        week.period.fiscalYear,
        week.period.periodNumber,
      );
      if (!result.ok) {
        window.alert(result.error ?? "Could not reopen the period.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <Link
        href="/close"
        className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border bg-secondary/40 px-4 text-sm font-bold tracking-tight text-foreground backdrop-blur-sm transition-all duration-200 outline-none hover:-translate-y-0.5 hover:border-primary/60 hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <CalendarCheck className="size-4" />
        Period close
      </Link>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleReopen}
        disabled={isPending || !week}
      >
        <LockOpen className="size-4" />
        Reopen period
      </Button>
    </>
  );
}
