"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { correctLockedWeek } from "@/lib/actions/week";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

interface CorrectionEntry {
  id: string;
  entryDate: string;
  hours: number;
  note: string | null;
  projectId: string | null;
  taskCodeId: string | null;
  nonProjectCategoryId: string | null;
  isHandsOn: boolean;
  projectName: string | null;
  taskCodeName: string | null;
  categoryName: string | null;
}

interface DraftEntry {
  id: string;
  hours: number;
  note: string;
}

interface CorrectionPanelProps {
  weekStartDate: string;
  entries: CorrectionEntry[];
  // TS-021/022: pass-through for delegated corrections; the server action
  // re-verifies admin permission, so this is never trusted on its own.
  targetUserId?: string | null;
}

function entryLabel(entry: CorrectionEntry): string {
  if (entry.taskCodeId) {
    const project = entry.projectName ?? "Unknown project";
    const code = entry.taskCodeName ?? "Unknown task code";
    return entry.isHandsOn
      ? `${project} · ${code} · hands-on`
      : `${project} · ${code}`;
  }
  return entry.categoryName ?? "Unknown category";
}

function entrySignature(entries: CorrectionEntry[]): string {
  return JSON.stringify(entries.map((e) => [e.id, e.hours, e.note]));
}

// TS-028 + TS-026: admin-only correction affordance for locked weeks. Renders
// only when the viewer is an admin and the week is locked; non-admins never
// see it and the server action rejects them regardless.
export function CorrectionPanel({
  weekStartDate,
  entries,
  targetUserId,
}: CorrectionPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const signature = entrySignature(entries);
  const [signatureKey, setSignatureKey] = useState(signature);
  const [drafts, setDrafts] = useState<DraftEntry[]>(() =>
    entries.map((e) => ({ id: e.id, hours: e.hours, note: e.note ?? "" })),
  );
  // Re-sync drafts when the refreshed page delivers new entry values.
  if (signatureKey !== signature) {
    setSignatureKey(signature);
    setDrafts(
      entries.map((e) => ({ id: e.id, hours: e.hours, note: e.note ?? "" })),
    );
  }

  function updateDraft(id: string, patch: Partial<DraftEntry>) {
    setDrafts((current) =>
      current.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );
  }

  function updateHours(id: string, raw: string) {
    const hours = raw === "" ? 0 : Number(raw);
    if (Number.isNaN(hours)) return;
    updateDraft(id, { hours });
  }

  function handleApply() {
    setError(null);
    // Mirror of the server check for immediate feedback — the action remains
    // the authoritative enforcement point.
    if (reason.trim().length === 0) {
      setError("A reason is required for every correction.");
      return;
    }
    startTransition(async () => {
      const result = await correctLockedWeek({
        weekStartDate,
        reason,
        entries: drafts.map((d) => ({
          timeEntryId: d.id,
          hours: d.hours,
          note: d.note.trim() === "" ? null : d.note,
        })),
        targetUserId,
      });
      if (!result.ok) {
        setError(result.error ?? "Could not apply the correction.");
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <section className="paper-card animate-fade-up rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="micro-label">Admin correction / Locked week</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Locked timesheets only change through a logged correction. Every
            edit is recorded with your name, the original values, and a
            mandatory reason.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            setOpen((v) => !v);
          }}
        >
          <Pencil className="size-4" />
          {open ? "Close correction" : "Correct locked week"}
        </Button>
      </div>

      {open ? (
        <div className="mt-4 flex flex-col gap-4">
          <Badge variant="outline">Restates this period on apply</Badge>

          {drafts.length === 0 ? (
            <div className="blueprint-surface rounded-xl p-4">
              <p className="micro-label">No entries in this week.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {entries.map((entry, index) => (
                <div
                  key={entry.id}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-background/30 p-3 backdrop-blur-sm lg:flex-row lg:items-end lg:gap-4"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="micro-label">
                      {formatDateLabel(entry.entryDate)}
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {entryLabel(entry)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-normal" htmlFor={`correction-hours-${entry.id}`}>
                      Hours
                    </Label>
                    <Input
                      id={`correction-hours-${entry.id}`}
                      type="number"
                      step="0.25"
                      min="0"
                      aria-label={`Corrected hours for ${entryLabel(entry)} on ${entry.entryDate}`}
                      value={drafts[index]?.hours ?? 0}
                      disabled={isPending}
                      onChange={(e) => updateHours(entry.id, e.target.value)}
                      className="w-24 text-center font-mono text-sm"
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Label className="text-xs font-normal" htmlFor={`correction-note-${entry.id}`}>
                      Note
                    </Label>
                    <Input
                      id={`correction-note-${entry.id}`}
                      aria-label={`Corrected note for ${entryLabel(entry)} on ${entry.entryDate}`}
                      placeholder="Note (optional)"
                      value={drafts[index]?.note ?? ""}
                      disabled={isPending}
                      onChange={(e) => updateDraft(entry.id, { note: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="correction-reason">
              Reason <span className="text-destructive">(required)</span>
            </Label>
            <Textarea
              id="correction-reason"
              aria-label="Correction reason"
              placeholder="Why is this locked week being corrected?"
              value={reason}
              disabled={isPending}
              onChange={(e) => setReason(e.target.value)}
              className="max-w-xl"
            />
          </div>

          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}

          <div>
            <Button onClick={handleApply} disabled={isPending || drafts.length === 0}>
              {isPending ? "Applying…" : "Apply corrections"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
