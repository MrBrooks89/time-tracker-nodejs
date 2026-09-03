"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { EmployeeAssignments } from "./employee-assignments";
import {
  DeleteEmployeeButton,
  EmployeeToggle,
} from "./employee-buttons";
import { EmployeeForm } from "./employee-form";
import { Button } from "@/components/ui/button";

export interface EmployeeRowData {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isSelf: boolean;
  team: string | null;
  title: string | null;
  employmentType: string;
  standardWeeklyHours: number;
  assignmentIds: string[];
}

export interface EmployeeProjectOption {
  id: string;
  name: string;
  number: number;
}

const employmentLabels: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contractor: "Contractor",
};

export function EmployeeRow({
  employee,
  projects,
}: {
  employee: EmployeeRowData;
  projects: EmployeeProjectOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);

  return (
    <>
      <TableRow>
        <TableCell className="whitespace-nowrap text-sm font-medium">
          <div className="flex flex-col">
            {employee.name}
            {employee.isSelf ? (
              <span className="text-xs text-muted-foreground">(you)</span>
            ) : null}
            <span className="text-xs text-muted-foreground">{employee.title ?? "—"}</span>
          </div>
        </TableCell>
        <TableCell className="whitespace-nowrap text-sm">
          <div className="flex flex-col">
            {employee.team ?? "—"}
            <span className="text-xs text-muted-foreground">
              {employmentLabels[employee.employmentType] ?? employee.employmentType}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <Badge>{employee.role}</Badge>
        </TableCell>
        <TableCell className="font-mono text-xs">
          {employee.standardWeeklyHours}h
        </TableCell>
        <TableCell>
          {employee.isActive ? (
            <Badge variant="secondary">Active</Badge>
          ) : (
            <Badge variant="outline">Deactivated</Badge>
          )}
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={editing}
              onClick={() => {
                setEditing((value) => !value);
                setAssigning(false);
              }}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={assigning}
              onClick={() => {
                setAssigning((value) => !value);
                setEditing(false);
              }}
            >
              Projects
            </Button>
            {employee.isSelf ? null : (
              <EmployeeToggle
                id={employee.id}
                isActive={employee.isActive}
                name={employee.name}
              />
            )}
            {employee.isSelf ? null : (
              <DeleteEmployeeButton id={employee.id} name={employee.name} />
            )}
          </div>
        </TableCell>
      </TableRow>
      {editing ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="border-b-0 p-0">
            <div className="animate-scale-in flex flex-col gap-4 border-l-2 border-primary/50 bg-background/30 px-4 py-4 backdrop-blur-sm">
              <p className="micro-label">People / Edit Employee</p>
              <EmployeeForm
                employee={{
                  id: employee.id,
                  name: employee.name,
                  role: employee.role,
                  isActive: employee.isActive,
                }}
                lockRole={employee.isSelf}
                onCancel={() => setEditing(false)}
              />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
      {assigning ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="border-b-0 p-0">
            <div className="animate-scale-in flex flex-col gap-4 border-l-2 border-primary/50 bg-background/30 px-4 py-4 backdrop-blur-sm">
              <EmployeeAssignments
                userId={employee.id}
                projectOptions={projects}
                initialIds={employee.assignmentIds}
              />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
