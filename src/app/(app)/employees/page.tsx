import { asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  project as projectTable,
  projectAssignment as assignmentTable,
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
import { AddEmployeeForm } from "./employee-form";
import { EmployeeRow, type EmployeeRowData } from "./employee-row";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const currentUser = await requirePeopleManager();

  const [users, activeProjects, assignments] = await Promise.all([
    db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        role: userTable.role,
        isActive: userTable.isActive,
        team: userTable.team,
        title: userTable.title,
        employmentType: userTable.employmentType,
        standardWeeklyHours: userTable.standardWeeklyHours,
      })
      .from(userTable)
      .orderBy(asc(userTable.name)),
    db
      .select({ id: projectTable.id, name: projectTable.name, number: projectTable.number })
      .from(projectTable)
      .where(eq(projectTable.isActive, true))
      .orderBy(asc(projectTable.name)),
    db
      .select({ userId: assignmentTable.userId, projectId: assignmentTable.projectId })
      .from(assignmentTable)
      .innerJoin(projectTable, eq(assignmentTable.projectId, projectTable.id))
      .where(
        isNull(assignmentTable.removedAt),
      ),
  ]);

  const activeAssignedProjectIds = new Set(
    assignments
      .filter((a) => activeProjects.some((p) => p.id === a.projectId))
      .map((a) => a.projectId),
  );

  const assignmentIdsByUser = new Map<string, string[]>();
  for (const row of assignments) {
    if (!activeAssignedProjectIds.has(row.projectId)) continue;
    const list = assignmentIdsByUser.get(row.userId) ?? [];
    list.push(row.projectId);
    assignmentIdsByUser.set(row.userId, list);
  }

  const rows: EmployeeRowData[] = users.map((item) => ({
    id: item.id,
    name: item.name,
    email: item.email,
    role: item.role,
    isActive: item.isActive,
    isSelf: item.id === currentUser.id,
    team: item.team,
    title: item.title,
    employmentType: item.employmentType,
    standardWeeklyHours: item.standardWeeklyHours,
    assignmentIds: assignmentIdsByUser.get(item.id) ?? [],
  }));

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-2 p-8">
        <p className="micro-label">People / Directory</p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Employees
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your team, roles, assignments, and account access.
        </p>
      </section>

      <AddEmployeeForm />

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">People / All Employees</p>
          <CardTitle className="flex items-center gap-3">
            Employees
            <Badge variant="secondary">
              {rows.length} {rows.length === 1 ? "person" : "people"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="blueprint-surface flex flex-1 items-center justify-center rounded-xl p-8">
              <p className="micro-label">NO PEOPLE YET</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Std hrs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <EmployeeRow
                    key={row.id}
                    employee={row}
                    projects={activeProjects}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
