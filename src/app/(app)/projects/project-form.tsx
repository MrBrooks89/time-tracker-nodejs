"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { createProject, updateProject } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface ProjectFormValues {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  projectManagerId: string | null;
  costType: string;
}

interface ProjectUserOption {
  id: string;
  name: string;
}

interface ProjectFormProps {
  project?: ProjectFormValues;
  users?: ProjectUserOption[];
  onCancel?: () => void;
}

export function ProjectForm({ project, users = [], onCancel }: ProjectFormProps) {
  const router = useRouter();
  const fieldId = useId();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = project
        ? await updateProject(project.id, formData)
        : await createProject(formData);
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-name`}>Name</Label>
          <Input
            id={`${fieldId}-name`}
            name="name"
            type="text"
            required
            defaultValue={project?.name ?? ""}
            disabled={isPending}
          />
        </div>
        {project ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-status`}>Status</Label>
            <Select
              id={`${fieldId}-status`}
              name="isActive"
              defaultValue={project.isActive ? "true" : "false"}
              disabled={isPending}
            >
              <option value="true">Active</option>
              <option value="false">Deactivated</option>
            </Select>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-pm`}>Project manager</Label>
          <Select
            id={`${fieldId}-pm`}
            name="projectManagerId"
            defaultValue={project?.projectManagerId ?? ""}
            disabled={isPending}
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-cost`}>Cost type</Label>
          <Select
            id={`${fieldId}-cost`}
            name="costType"
            defaultValue={project?.costType ?? "operating"}
            disabled={isPending}
          >
            <option value="capital">Capital</option>
            <option value="operating">Operating</option>
            <option value="mixed">Mixed</option>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${fieldId}-description`}>Description</Label>
        <Textarea
          id={`${fieldId}-description`}
          name="description"
          rows={2}
          placeholder="Optional"
          className="min-h-16"
          defaultValue={project?.description ?? ""}
          disabled={isPending}
        />
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
          {project ? "Save changes" : "Add project"}
        </Button>
      </div>
    </form>
  );
}

export function AddProjectForm({ users }: { users: ProjectUserOption[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Add project
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-scale-in flex flex-col gap-4 rounded-2xl border border-border bg-background/30 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]">
      <p className="micro-label">Workspace / New Project</p>
      <ProjectForm users={users} onCancel={() => setOpen(false)} />
    </div>
  );
}
