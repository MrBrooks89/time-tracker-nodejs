import { asc, count, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import {
  project as projectTable,
  timeEntry,
  user as userTable,
} from "@/db/schema";
import { requirePeopleManager } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddProjectForm } from "./project-form";
import { ProjectRow, type ProjectRowData } from "./project-row";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  await requirePeopleManager();

  const [projects, usage, users] = await Promise.all([
    db
      .select({
        id: projectTable.id,
        number: projectTable.number,
        name: projectTable.name,
        description: projectTable.description,
        projectManagerId: projectTable.projectManagerId,
        costType: projectTable.costType,
        isActive: projectTable.isActive,
      })
      .from(projectTable)
      .orderBy(asc(projectTable.name)),
    db
      .select({
        projectId: timeEntry.projectId,
        entryCount: count(),
      })
      .from(timeEntry)
      .where(isNotNull(timeEntry.projectId))
      .groupBy(timeEntry.projectId),
    db
      .select({ id: userTable.id, name: userTable.name })
      .from(userTable)
      .where(eq(userTable.isActive, true))
      .orderBy(asc(userTable.name)),
  ]);

  const usageByProject = new Map<string, number>();
  for (const row of usage) {
    if (row.projectId) {
      usageByProject.set(row.projectId, Number(row.entryCount));
    }
  }

  const rows: ProjectRowData[] = projects.map((project) => ({
    id: project.id,
    number: project.number,
    name: project.name,
    description: project.description,
    projectManagerId: project.projectManagerId,
    costType: project.costType,
    entryCount: usageByProject.get(project.id) ?? 0,
    isActive: project.isActive,
  }));

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-2 p-8">
        <p className="micro-label">Workspace / Projects</p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Projects
        </h1>
        <p className="text-sm text-muted-foreground">
          Organize the work your team logs hours against.
        </p>
      </section>

      <AddProjectForm users={users} />

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Workspace / All Projects</p>
          <CardTitle className="flex items-center gap-3">
            Projects
            <Badge variant="secondary">
              {rows.length} {rows.length === 1 ? "project" : "projects"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="blueprint-surface flex flex-1 items-center justify-center rounded-xl p-8">
              <p className="micro-label">NO PROJECTS YET</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Cost type</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <ProjectRow key={row.id} project={row} users={users} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
