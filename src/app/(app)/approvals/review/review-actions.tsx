"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { approveTimesheet, rejectTimesheet } from "@/lib/actions/approvals";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ReviewActions({
  userId,
  weekStartDate,
}: {
  userId: string;
  weekStartDate: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  function runAction(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      // Decision made — the sheet leaves the queue, so return to it.
      router.push("/approvals");
      router.refresh();
    });
  }

  function handleApprove() {
    if (
      !window.confirm(
        "Approve this timesheet? The partner's week is locked in as approved.",
      )
    ) {
      return;
    }
    runAction(() => approveTimesheet(userId, weekStartDate));
  }

  function handleReject() {
    if (!note.trim()) {
      setError("A rejection note is required.");
      return;
    }
    runAction(() => rejectTimesheet(userId, weekStartDate, note));
  }

  return (
    <div className="paper-card animate-scale-in flex flex-col gap-4 rounded-2xl p-6">
      <p className="micro-label">Decision / Approve or return for correction</p>
      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : null}
      {rejecting ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="rejection-note">
            Rejection note (required — shown to the partner)
          </Label>
          <Textarea
            id="rejection-note"
            value={note}
            placeholder="Explain what needs correcting before resubmission…"
            disabled={isPending}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={handleReject}
            >
              {isPending ? "Returning…" : "Return for correction"}
            </Button>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => {
                setRejecting(false);
                setNote("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleApprove} disabled={isPending}>
            {isPending ? "Approving…" : "Approve"}
          </Button>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => setRejecting(true)}
          >
            Return for correction
          </Button>
        </div>
      )}
    </div>
  );
}
