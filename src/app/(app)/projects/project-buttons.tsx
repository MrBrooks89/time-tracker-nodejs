"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, Trash2 } from "lucide-react";

import { deleteProject, updateProject } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";

export function ProjectToggle({
  id,
  isActive,
  name,
  description,
  projectManagerId,
  costType,
}: {
  id: string;
  isActive: boolean;
  name: string;
  description: string;
  projectManagerId: string;
  costType: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const formData = new FormData();
    formData.set("name", name);
    formData.set("description", description);
    formData.set("isActive", isActive ? "false" : "true");
    formData.set("projectManagerId", projectManagerId);
    formData.set("costType", costType);
    startTransition(async () => {
      const result = await updateProject(id, formData);
      if (!result.ok) return;
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={isPending}
      aria-label={isActive ? "Deactivate project" : "Reactivate project"}
    >
      <Power className="size-4" />
      <span className="sr-only">
        {isActive ? "Deactivate project" : "Reactivate project"}
      </span>
    </Button>
  );
}

export function DeleteProjectButton({
  id,
  name,
  hasEntries,
}: {
  id: string;
  name: string;
  hasEntries?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm(`Delete ${name}?`)) return;
    startTransition(async () => {
      const result = await deleteProject(id);
      if (!result.ok) {
        setError(result.error ?? "Could not delete this project.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/15 hover:text-destructive"
        onClick={handleClick}
        disabled={isPending}
        aria-label={
          hasEntries
            ? "This project has logged time and can't be deleted. Deactivate it instead."
            : "Delete project"
        }
      >
        <Trash2 className="size-4" />
        <span className="sr-only">Delete project</span>
      </Button>
      {error ? (
        <p className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-destructive/30 bg-popover p-2 text-left text-xs font-medium text-destructive shadow-lg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
