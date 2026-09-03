"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  DeleteProjectButton,
  ProjectToggle,
} from "./project-buttons";
import { ProjectForm } from "./project-form";

export interface ProjectUserOption {
  id: string;
  name: string;
}

export interface ProjectRowData {
  id: string;
  number: number;
  name: string;
  description: string | null;
  projectManagerId: string | null;
  costType: string;
  entryCount: number;
  isActive: boolean;
}

export function ProjectRow({
  project,
  users,
}: {
  project: ProjectRowData;
  users: ProjectUserOption[];
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <TableRow>
        <TableCell className="whitespace-nowrap text-sm font-medium">
          <span className="mr-2 font-mono text-xs text-muted-foreground">
            #{project.number}
          </span>
          {project.name}
          <span className="block max-w-[16rem] truncate text-xs text-muted-foreground">
            {project.description ?? ""}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
          {users.find((u) => u.id === project.projectManagerId)?.name ?? "—"}
        </TableCell>
        <TableCell>
          <Badge variant="secondary" className="capitalize">
            {project.costType}
          </Badge>
        </TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs">
          {project.entryCount}
        </TableCell>
        <TableCell>
          {project.isActive ? (
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
              onClick={() => setEditing((value) => !value)}
            >
              <Pencil className="size-4" />
              <span className="sr-only">Edit project</span>
            </Button>
            <ProjectToggle
              id={project.id}
              isActive={project.isActive}
              name={project.name}
              description={project.description ?? ""}
              projectManagerId={project.projectManagerId ?? ""}
              costType={project.costType}
            />
            {project.entryCount > 0 ? (
              <DeleteProjectButton
                id={project.id}
                name={project.name}
                hasEntries
              />
            ) : (
              <DeleteProjectButton id={project.id} name={project.name} />
            )}
          </div>
        </TableCell>
      </TableRow>
      {editing ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="border-b-0 p-0">
            <div className="animate-scale-in flex flex-col gap-4 border-l-2 border-primary/50 bg-background/30 px-4 py-4 backdrop-blur-sm">
              <p className="micro-label">Workspace / Edit Project</p>
              <ProjectForm
                project={{
                  id: project.id,
                  name: project.name,
                  description: project.description,
                  isActive: project.isActive,
                  projectManagerId: project.projectManagerId,
                  costType: project.costType,
                }}
                users={users}
                onCancel={() => setEditing(false)}
              />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
