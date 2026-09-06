"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Lock, RotateCcw } from "lucide-react";

import {
  finalizeClose,
  initiateClose,
  reopenPeriod,
} from "@/lib/actions/close";
import { Button } from "@/components/ui/button";

export function CloseActions({
  fiscalYear,
  periodNumber,
  status,
  outlierCount,
  gate,
}: {
  fiscalYear: number;
  periodNumber: number;
  status: "open" | "window" | "closed";
  outlierCount: number;
  gate: { canFinalize: boolean; awaiting: number; inCorrection: number; windowEndsAt: string | null };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleInitiate() {
    const message =
      outlierCount > 0
        ? `Initiate close for FY${fiscalYear} P${periodNumber}? ${outlierCount} outlier sheet${outlierCount === 1 ? " goes" : "s go"} to correction and the correction window opens.`
        : `Initiate close for FY${fiscalYear} P${periodNumber}? The correction window opens.`;
    if (!window.confirm(message)) return;
    startTransition(async () => {
      const result = await initiateClose(fiscalYear, periodNumber);
      if (!result.ok) {
        window.alert(result.error ?? "Could not initiate close.");
        return;
      }
      router.refresh();
    });
  }

  function handleFinalize() {
    if (
      !window.confirm(
        `Finalize FY${fiscalYear} P${periodNumber}? All timesheets in the period become locked.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await finalizeClose(fiscalYear, periodNumber);
      if (!result.ok) {
        window.alert(result.error ?? "Could not finalize the period.");
        return;
      }
      router.refresh();
    });
  }

  function handleReopen() {
    if (
      !window.confirm(
        `Reopen FY${fiscalYear} P${periodNumber}? Locked timesheets return to their prior states.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await reopenPeriod(fiscalYear, periodNumber);
      if (!result.ok) {
        window.alert(result.error ?? "Could not reopen the period.");
        return;
      }
      router.refresh();
    });
  }

  if (status === "closed") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleReopen}
        disabled={isPending}
      >
        <RotateCcw className="size-4" />
        Reopen period
      </Button>
    );
  }

  if (status === "window") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Button
          variant="default"
          size="sm"
          onClick={handleFinalize}
          disabled={isPending || !gate.canFinalize}
        >
          <Lock className="size-4" />
          Finalize period
        </Button>
        {!gate.canFinalize ? (
          <p className="text-xs text-muted-foreground">
            Awaiting approval: {gate.awaiting} · In correction:{" "}
            {gate.inCorrection} · Window ends {gate.windowEndsAt ?? "—"}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Button variant="default" size="sm" onClick={handleInitiate} disabled={isPending}>
      <CalendarCheck className="size-4" />
      Initiate close
    </Button>
  );
}
