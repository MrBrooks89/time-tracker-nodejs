"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, Trash2 } from "lucide-react";

import {
  deleteEmployee,
  updateEmployee,
  type ActionResult,
} from "@/lib/actions/people";
import { Button } from "@/components/ui/button";

export function EmployeeToggle({
  id,
  isActive,
  name,
}: {
  id: string;
  isActive: boolean;
  name: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const formData = new FormData();
    formData.set("name", name);
    formData.set("role", "");
    formData.set("isActive", isActive ? "false" : "true");
    startTransition(async () => {
      const result = await updateEmployee(id, formData);
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
      aria-label={isActive ? "Deactivate employee" : "Reactivate employee"}
    >
      <Power className="size-4" />
      <span className="sr-only">
        {isActive ? "Deactivate employee" : "Reactivate employee"}
      </span>
    </Button>
  );
}

export function DeleteEmployeeButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    startTransition(async () => {
      const result: ActionResult = await deleteEmployee(id);
      if (!result.ok) return;
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:bg-destructive/15 hover:text-destructive"
      onClick={handleClick}
      disabled={isPending}
    >
      <Trash2 className="size-4" />
      <span className="sr-only">Delete employee</span>
    </Button>
  );
}
