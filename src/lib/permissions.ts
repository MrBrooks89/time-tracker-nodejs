import { redirect } from "next/navigation";

import { requireUser, type Role, type SessionUser } from "./session";

export async function requireRole(roles: Array<Role>): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    redirect("/");
  }
  return user;
}

export function canManagePeople(role: Role): boolean {
  return role === "admin" || role === "manager";
}

export async function requirePeopleManager(): Promise<SessionUser> {
  return requireRole(["admin", "manager"]);
}
