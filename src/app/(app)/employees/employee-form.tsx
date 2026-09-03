"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { createEmployee, updateEmployee } from "@/lib/actions/people";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface EmployeeFormValues {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

interface EmployeeFormProps {
  employee?: EmployeeFormValues;
  lockRole?: boolean;
  onCancel?: () => void;
}

function PasswordInput({
  fieldId,
  isPending,
}: {
  fieldId: string;
  isPending: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${fieldId}-password`}>Password</Label>
      <Input
        id={`${fieldId}-password`}
        name="password"
        type="password"
        required
        minLength={8}
        placeholder="At least 8 characters"
        disabled={isPending}
      />
    </div>
  );
}

export function EmployeeForm({
  employee,
  lockRole,
  onCancel,
}: EmployeeFormProps) {
  const router = useRouter();
  const fieldId = useId();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = employee
        ? await updateEmployee(employee.id, formData)
        : await createEmployee(formData);
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-name`}>Name</Label>
          <Input
            id={`${fieldId}-name`}
            name="name"
            type="text"
            required
            defaultValue={employee?.name ?? ""}
            disabled={isPending}
          />
        </div>
        {employee ? null : (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-email`}>Email</Label>
            <Input
              id={`${fieldId}-email`}
              name="email"
              type="email"
              required
              placeholder="name@company.com"
              disabled={isPending}
            />
          </div>
        )}
        {employee ? null : (
          <PasswordInput fieldId={fieldId} isPending={isPending} />
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-role`}>Role</Label>
          <Select
            id={`${fieldId}-role`}
            name="role"
            defaultValue={employee?.role ?? "employee"}
            disabled={isPending || lockRole}
          >
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </Select>
          {lockRole ? (
            <p className="text-xs text-muted-foreground">
              You cannot change your own role.
            </p>
          ) : null}
        </div>
        {employee ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-status`}>Status</Label>
            <Select
              id={`${fieldId}-status`}
              name="isActive"
              defaultValue={employee.isActive ? "true" : "false"}
              disabled={isPending || lockRole}
            >
              <option value="true">Active</option>
              <option value="false">Deactivated</option>
            </Select>
            {lockRole ? (
              <p className="text-xs text-muted-foreground">
                You cannot deactivate your own account.
              </p>
            ) : null}
          </div>
        ) : null}
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
          {employee ? "Save changes" : "Add employee"}
        </Button>
      </div>
    </form>
  );
}

export function AddEmployeeForm() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Add employee
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-scale-in flex flex-col gap-4 rounded-2xl border border-border bg-background/30 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]">
      <p className="micro-label">People / New Employee</p>
      <EmployeeForm onCancel={() => setOpen(false)} />
    </div>
  );
}
