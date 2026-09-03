import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./auth";

export type Role = "admin" | "manager" | "employee";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) return null;

  const rawUser = session.user as Record<string, unknown>;
  const role = (rawUser.role as Role) ?? "employee";
  const isActive =
    typeof rawUser.isActive === "boolean" ? rawUser.isActive : true;

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    image: session.user.image,
    role,
    isActive,
    createdAt: session.user.createdAt,
    updatedAt: session.user.updatedAt,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
