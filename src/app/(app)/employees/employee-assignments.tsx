"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setAssignments } from "@/lib/actions/people";
import { Button } from "@/components/ui/button";
import type { EmployeeProjectOption } from "./employee-row";

export function EmployeeAssignments({
  userId,
  projectOptions,
  initialIds,
}: {
  userId: string;
  projectOptions: EmployeeProjectOption[];
  initialIds: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(initialIds));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(projectId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await setAssignments(userId, [...selected]);
      if (!result.ok) {
        setError(result.error ?? "Could not save assignments.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="micro-label">Projects / Assignments</p>
      <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-2 sm:grid-cols-2 lg:grid-cols-3">
        {projectOptions.map((project) => (
          <label
            key={project.id}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background/30 px-3 py-2 text-sm transition-colors hover:border-primary/40"
          >
            <input
              type="checkbox"
              checked={selected.has(project.id)}
              onChange={() => toggle(project.id)}
              disabled={isPending}
            />
            <span className="truncate">
              #{project.number} {project.name}
            </span>
          </label>
        ))}
      </div>
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save assignments"}
        </Button>
      </div>
    </div>
  );
}
