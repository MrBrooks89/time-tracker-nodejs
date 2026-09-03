"use server";

import { eq, ne, and, count, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { project as projectTable, timeEntry } from "@/db/schema";
import { requirePeopleManager } from "@/lib/permissions";

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
  await requirePeopleManager();

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

    await db.insert(projectTable).values({
      id: crypto.randomUUID(),
      number: nextNumber,
      name,
      description: description || null,
      projectManagerId: projectManagerId || null,
      costType: costType as CostTypeValue,
      isActive: true,
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
  await requirePeopleManager();

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

  await db
    .update(projectTable)
    .set({
      name,
      description: description || null,
      projectManagerId: projectManagerId || null,
      costType: costType as CostTypeValue,
      isActive: nextIsActive,
      updatedAt: new Date(),
    })
    .where(eq(projectTable.id, id));

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
