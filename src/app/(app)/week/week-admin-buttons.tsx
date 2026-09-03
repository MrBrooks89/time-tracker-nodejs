"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LockOpen } from "lucide-react";

import { simulateClose, unlockWeek } from "@/lib/actions/week";
import { Button } from "@/components/ui/button";

export function WeekAdminButtons({ weekStartDate }: { weekStartDate: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClose() {
    if (!window.confirm("Simulate period close for this week? All timesheets for this week become read-only.")) {
      return;
    }
    startTransition(async () => {
      await simulateClose(weekStartDate);
      router.refresh();
    });
  }

  function handleUnlock() {
    startTransition(async () => {
      await unlockWeek(weekStartDate);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleClose}
        disabled={isPending}
      >
        Simulate close
      </Button>
      <Button variant="ghost" size="sm" onClick={handleUnlock} disabled={isPending}>
        <LockOpen className="size-4" />
        Unlock
      </Button>
    </>
  );
}
