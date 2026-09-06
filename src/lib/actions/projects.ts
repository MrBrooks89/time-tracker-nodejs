"use server";

import { eq, ne, and, count, isNull, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  assignmentChange,
  project as projectTable,
  projectAssignment,
  timeEntry,
  user as userTable,
} from "@/db/schema";
import {
  canManageAssignmentsFor,
  requirePeopleManager,
} from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const costTypeValues = ["capital", "operating", "mixed"] as const;
type CostTypeValue = (typeof costTypeValues)[number];

function revalidateProjectPaths() {
  revalidatePath("/");
  revalidatePath("/projects");
  revalidatePath("/week");
  revalidatePath("/reports");
}

async function isNameTaken(name: string, excludeId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      excludeId
        ? and(eq(projectTable.name, name), ne(projectTable.id, excludeId))
        : eq(projectTable.name, name),
    )
    .limit(1);
  return Boolean(row);
}

export async function createProject(
  formData: FormData,
): Promise<ActionResult> {
  const currentUser = await requirePeopleManager();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const projectManagerId = String(formData.get("projectManagerId") ?? "").trim();
  const costType = String(formData.get("costType") ?? "").trim();

  if (!name) {
    return { ok: false, error: "Name is required." };
  }

  if (!costTypeValues.includes(costType as CostTypeValue)) {
    return { ok: false, error: "Choose a valid cost type." };
  }

  if (await isNameTaken(name)) {
    return { ok: false, error: "A project with this name already exists." };
  }

  try {
    const [maxRow] = await db
      .select({ value: max(projectTable.number) })
      .from(projectTable);
    const nextNumber = Number(maxRow?.value ?? 0) + 1;
    const projectId = crypto.randomUUID();

    // Sync callback + .run(): better-sqlite3 transactions reject promise-
    // returning callbacks, so the insert and audit write are atomic.
    db.transaction((tx) => {
      tx.insert(projectTable)
        .values({
          id: projectId,
          number: nextNumber,
          name,
          description: description || null,
          projectManagerId: projectManagerId || null,
          costType: costType as CostTypeValue,
          isActive: true,
        })
        .run();

      // DA-009: project creation is audited atomically.
      recordAudit(tx, {
        actorId: currentUser.id,
        action: "project_create",
        entityType: "project",
        entityId: projectId,
        newValue: JSON.stringify({
          number: nextNumber,
          name,
          costType,
        }),
      });
    });
  } catch {
    return { ok: false, error: "A project with this name already exists." };
  }

  revalidateProjectPaths();
  return { ok: true };
}

export async function updateProject(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const currentUser = await requirePeopleManager();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const isActiveRaw = formData.get("isActive");
  const projectManagerId = String(formData.get("projectManagerId") ?? "").trim();
  const costType = String(formData.get("costType") ?? "").trim();

  if (!name) {
    return { ok: false, error: "Name is required." };
  }

  if (!costTypeValues.includes(costType as CostTypeValue)) {
    return { ok: false, error: "Choose a valid cost type." };
  }

  const [target] = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      projectManagerId: projectTable.projectManagerId,
      costType: projectTable.costType,
      isActive: projectTable.isActive,
    })
    .from(projectTable)
    .where(eq(projectTable.id, id))
    .limit(1);
  if (!target) {
    return { ok: false, error: "Project not found." };
  }

  const nextIsActive =
    isActiveRaw === null ? target.isActive : isActiveRaw === "true";

  if (await isNameTaken(name, id)) {
    return { ok: false, error: "A project with this name already exists." };
  }

  // DA-009: deactivating a project is its own audit action; other changes
  // are a plain update. Old/new values are compact JSON of the fields.
  const deactivated = target.isActive && !nextIsActive;

  // Sync callback + .run(): better-sqlite3 transactions reject promise-
  // returning callbacks, so the update and audit write are atomic.
  db.transaction((tx) => {
    tx
      .update(projectTable)
      .set({
        name,
        description: description || null,
        projectManagerId: projectManagerId || null,
        costType: costType as CostTypeValue,
        isActive: nextIsActive,
        updatedAt: new Date(),
      })
      .where(eq(projectTable.id, id))
      .run();

    recordAudit(tx, {
      actorId: currentUser.id,
      action: deactivated ? "project_deactivate" : "project_update",
      entityType: "project",
      entityId: id,
      oldValue: JSON.stringify({
        name: target.name,
        projectManagerId: target.projectManagerId,
        costType: target.costType,
        isActive: target.isActive,
      }),
      newValue: JSON.stringify({
        name,
        projectManagerId: projectManagerId || null,
        costType,
        isActive: nextIsActive,
      }),
    });
  });

  revalidateProjectPaths();
  return { ok: true };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  await requirePeopleManager();

  const [target] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(eq(projectTable.id, id))
    .limit(1);
  if (!target) {
    return { ok: false, error: "Project not found." };
  }

  const [usage] = await db
    .select({ value: count() })
    .from(timeEntry)
    .where(eq(timeEntry.projectId, id));

  if (Number(usage?.value ?? 0) > 0) {
    return {
      ok: false,
      error:
        "This project has logged time and can't be deleted. Deactivate it instead.",
    };
  }

  await db.delete(projectTable).where(eq(projectTable.id, id));

  revalidateProjectPaths();
  return { ok: true };
}

// Section 1.4: project_manager assignment management. A PM may assign/
// unassign partners on the projects where projectManagerId = self — the
// /projects page re-verifies, this action is the enforcement point.
export async function setProjectTeam(
  projectId: string,
  userIds: string[],
): Promise<ActionResult> {
  const currentUser = await requireUser();

  const [project] = await db
    .select({
      id: projectTable.id,
      projectManagerId: projectTable.projectManagerId,
      isActive: projectTable.isActive,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  // Server-side permission check is authoritative: admins/managers manage
  // any project's team; a project_manager only their own projects.
  if (!canManageAssignmentsFor(project.projectManagerId, currentUser)) {
    return {
      ok: false,
      error: "Not permitted: you can only manage assignments for your own projects.",
    };
  }

  const activeUsers = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.isActive, true));
  const activeIds = new Set(activeUsers.map((u) => u.id));
  const desired = [...new Set(userIds)];
  for (const userId of desired) {
    if (!activeIds.has(userId)) {
      return { ok: false, error: "Partner not found or inactive." };
    }
  }

  const current = await db
    .select({
      id: projectAssignment.id,
      userId: projectAssignment.userId,
    })
    .from(projectAssignment)
    .where(
      and(
        eq(projectAssignment.projectId, projectId),
        isNull(projectAssignment.removedAt),
      ),
    );

  const currentIds = new Set(current.map((c) => c.userId));
  const desiredIds = new Set(desired);

  const now = new Date();
  const logs: Array<typeof assignmentChange.$inferInsert> = [];

  for (const row of current) {
    if (!desiredIds.has(row.userId)) {
      await db
        .update(projectAssignment)
        .set({ removedAt: now })
        .where(eq(projectAssignment.id, row.id));
      logs.push({
        id: crypto.randomUUID(),
        userId: row.userId,
        projectId,
        changedBy: currentUser.id,
        changeType: "unassigned",
        changedAt: now,
      });
    }
  }

  for (const userId of desired) {
    if (!currentIds.has(userId)) {
      await db.insert(projectAssignment).values({
        id: crypto.randomUUID(),
        userId,
        projectId,
        assignedBy: currentUser.id,
        assignedAt: now,
      });
      logs.push({
        id: crypto.randomUUID(),
        userId,
        projectId,
        changedBy: currentUser.id,
        changeType: "assigned",
        changedAt: now,
      });
    }
  }

  if (logs.length > 0) {
    await db.insert(assignmentChange).values(logs);
  }

  revalidateProjectPaths();
  revalidatePath("/employees");
  return { ok: true };
}
