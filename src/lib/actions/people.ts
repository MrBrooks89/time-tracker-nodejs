"use server";

import { and, count, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { hashPassword } from "better-auth/crypto";

import { db } from "@/db";
import {
  assignmentChange,
  project as projectTable,
  projectAssignment,
  account,
  session,
  timeEntry,
  timesheet,
  user as userTable,
} from "@/db/schema";
import { requirePeopleManager } from "@/lib/permissions";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const roleValues = ["admin", "manager", "employee"] as const;
type RoleValue = (typeof roleValues)[number];

function isRole(value: string): value is RoleValue {
  return (roleValues as readonly string[]).includes(value);
}

function revalidatePeoplePaths() {
  revalidatePath("/");
  revalidatePath("/employees");
  revalidatePath("/week");
  revalidatePath("/reports");
}

export async function createEmployee(
  formData: FormData,
): Promise<ActionResult> {
  await requirePeopleManager();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!name) {
    return { ok: false, error: "Name is required." };
  }
  if (!email) {
    return { ok: false, error: "Email is required." };
  }
  if (password.length < 8) {
    return {
      ok: false,
      error: "Password must be at least 8 characters.",
    };
  }
  if (!isRole(role)) {
    return { ok: false, error: "Choose a valid role." };
  }

  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);
  if (existing) {
    return { ok: false, error: "A user with this email already exists." };
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date();

  try {
    db.transaction((tx) => {
      tx.insert(userTable)
        .values({
          id: userId,
          name,
          email,
          emailVerified: false,
          role,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(account)
        .values({
          id: crypto.randomUUID(),
          accountId: userId,
          providerId: "credential",
          userId,
          password: passwordHash,
          issuer: "local:credential",
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
  } catch {
    return { ok: false, error: "A user with this email already exists." };
  }

  revalidatePeoplePaths();
  return { ok: true };
}

export async function updateEmployee(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const currentUser = await requirePeopleManager();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const isActiveRaw = formData.get("isActive");

  if (!name) {
    return { ok: false, error: "Name is required." };
  }

  const [target] = await db
    .select({
      id: userTable.id,
      role: userTable.role,
      isActive: userTable.isActive,
    })
    .from(userTable)
    .where(eq(userTable.id, id))
    .limit(1);
  if (!target) {
    return { ok: false, error: "Employee not found." };
  }

  const nextRole = isRole(role) ? role : target.role;
  const nextIsActive =
    isActiveRaw === null ? target.isActive : isActiveRaw === "true";

  if (id === currentUser.id && nextRole !== currentUser.role) {
    return { ok: false, error: "You cannot change your own role." };
  }
  if (id === currentUser.id && !nextIsActive) {
    return { ok: false, error: "You cannot deactivate your own account." };
  }

  try {
    await db
      .update(userTable)
      .set({ name, role: nextRole, isActive: nextIsActive, updatedAt: new Date() })
      .where(eq(userTable.id, id));
  } catch {
    return { ok: false, error: "Could not save this employee." };
  }

  if (!nextIsActive) {
    await db.delete(session).where(eq(session.userId, id));
  }

  revalidatePeoplePaths();
  return { ok: true };
}

export async function deleteEmployee(id: string): Promise<ActionResult> {
  const currentUser = await requirePeopleManager();

  if (id === currentUser.id) {
    return { ok: false, error: "You cannot delete your own account." };
  }

  const [target] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, id))
    .limit(1);
  if (!target) {
    return { ok: false, error: "Employee not found." };
  }

  const [usage] = await db
    .select({ value: count() })
    .from(timeEntry)
    .innerJoin(timesheet, eq(timeEntry.timesheetId, timesheet.id))
    .where(eq(timesheet.userId, id));

  if (Number(usage?.value ?? 0) > 0) {
    return {
      ok: false,
      error: "This partner has logged time and can't be deleted. Deactivate instead.",
    };
  }

  await db.delete(session).where(eq(session.userId, id));
  await db.delete(userTable).where(eq(userTable.id, id));

  revalidatePeoplePaths();
  return { ok: true };
}

export async function setAssignments(
  userId: string,
  projectIds: string[],
): Promise<ActionResult> {
  const currentUser = await requirePeopleManager();

  const activeProjects = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(eq(projectTable.isActive, true));
  const activeIds = new Set(activeProjects.map((p) => p.id));
  for (const projectId of projectIds) {
    if (!activeIds.has(projectId)) {
      return { ok: false, error: "Project not found or inactive." };
    }
  }

  const current = await db
    .select({
      id: projectAssignment.id,
      projectId: projectAssignment.projectId,
    })
    .from(projectAssignment)
    .where(
      and(eq(projectAssignment.userId, userId), isNull(projectAssignment.removedAt)),
    );

  const currentIds = new Set(current.map((c) => c.projectId));
  const desiredIds = new Set(projectIds);

  const now = new Date();
  const logs: Array<typeof assignmentChange.$inferInsert> = [];

  for (const row of current) {
    if (!desiredIds.has(row.projectId)) {
      await db
        .update(projectAssignment)
        .set({ removedAt: now })
        .where(eq(projectAssignment.id, row.id));
      logs.push({
        id: crypto.randomUUID(),
        userId,
        projectId: row.projectId,
        changedBy: currentUser.id,
        changeType: "unassigned",
        changedAt: now,
      });
    }
  }

  for (const projectId of projectIds) {
    if (!currentIds.has(projectId)) {
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

  revalidatePath("/employees");
  revalidatePath("/projects");
  revalidatePath("/week");
  revalidatePath("/reports");
  return { ok: true };
}
