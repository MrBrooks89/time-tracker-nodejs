"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";

import { setProjectTeam } from "@/lib/actions/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface TeamMemberOption {
  id: string;
  name: string;
}

// Section 1.4: assignment management for a project the viewer manages.
// The setProjectTeam server action re-verifies that the caller is the
// project's manager (or an admin/manager) — this UI is convenience only.
export function PmTeamRow({
  projectId,
  projectName,
  projectNumber,
  members,
  assignedIds,
}: {
  projectId: string;
  projectName: string;
  projectNumber: number;
  members: TeamMemberOption[];
  assignedIds: string[];
}) {
  const router = useRouter();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const selected = formData
      .getAll("memberIds")
      .map((value) => String(value));
    setError(null);
    startTransition(async () => {
      const result = await setProjectTeam(projectId, selected);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border/60 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            #{projectNumber}
          </span>
          <span className="text-sm font-semibold">{projectName}</span>
          <Badge variant="secondary">{assignedIds.length} assigned</Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Users className="size-4" />
          {open ? "Hide team" : "Manage team"}
        </Button>
      </div>
      {open ? (
        <form
          onSubmit={handleSubmit}
          className="animate-scale-in flex flex-col gap-4 rounded-xl border border-border bg-background/30 p-4 backdrop-blur-sm"
        >
          <p className="micro-label">Workspace / Project Team</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => {
              const checkboxId = `${fieldId}-${member.id}`;
              return (
                <div key={member.id} className="flex items-center gap-2">
                  <input
                    id={checkboxId}
                    name="memberIds"
                    type="checkbox"
                    value={member.id}
                    defaultChecked={assignedIds.includes(member.id)}
                    disabled={isPending}
                    className="size-4 rounded border-border bg-background/60 accent-[var(--ring)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                  <Label htmlFor={checkboxId} className="text-sm font-normal">
                    {member.name}
                  </Label>
                </div>
              );
            })}
          </div>
          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save team"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
