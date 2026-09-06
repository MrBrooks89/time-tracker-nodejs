import { redirect } from "next/navigation";

import { requireUser, type Role, type SessionUser } from "./session";

export async function requireRole(roles: Array<Role>): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    redirect("/");
  }
  return user;
}

// ---------------------------------------------------------------------------
// Capability matrix (Section 1.4 roles). Every server action and page gates
// through these helpers — nav gating in app-nav.tsx is cosmetic only.
// ---------------------------------------------------------------------------

/** Read-only roles see dashboards/reports but can never mutate anything. */
export function isReadOnlyRole(role: Role): boolean {
  return role === "finance_viewer" || role === "leadership";
}

/** Week entry (and any timesheet mutation) is closed to read-only roles. */
export function canEnterWeeks(role: Role): boolean {
  return !isReadOnlyRole(role);
}

/** Audit viewer: admin-only (DA-009). */
export function canViewAudit(role: Role): boolean {
  return role === "admin";
}

/** All roles may reach /reports; the visible tabs are scoped per role. */
export function canViewReports(role: Role): boolean {
  void role;
  return true;
}

/** People admin (directory, roles, activation): admin + manager only. */
export function canManagePeople(role: Role): boolean {
  return role === "admin" || role === "manager";
}

/** Project lifecycle (create/update/deactivate projects): admin + manager. */
export function canManageProjects(role: Role): boolean {
  return role === "admin" || role === "manager";
}

/**
 * Assignment management for a specific project: admins/managers manage any
 * project; a project_manager only the projects where projectManagerId = self.
 */
export function canManageAssignmentsFor(
  projectManagerId: string | null,
  user: { id: string; role: Role },
): boolean {
  if (canManageProjects(user.role)) return true;
  return user.role === "project_manager" && projectManagerId === user.id;
}

/** Partner-level filters (team/manager/partner) on reports. */
export function canFilterReportsByPartner(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "leadership";
}

/** Projects page: full admin view, or the PM's scoped read view. */
export function canViewProjectsAdmin(role: Role): boolean {
  return canManageProjects(role) || role === "project_manager";
}

export const REPORT_TABS = [
  "dashboard",
  "actuals",
  "compliance",
  "classification",
] as const;

export type ReportTab = (typeof REPORT_TABS)[number];

/**
 * Which report tabs each role may open. finance_viewer gets aggregate
 * classification/actuals totals only — no dashboard drill-downs and no
 * per-partner compliance rows. project_manager gets project-scoped reports
 * but not the partner-centric compliance sheet.
 */
export function allowedReportTabs(role: Role): ReportTab[] {
  if (role === "finance_viewer") return ["actuals", "classification"];
  if (role === "project_manager") {
    return ["dashboard", "actuals", "classification"];
  }
  return [...REPORT_TABS];
}

// finance_viewer/leadership never file timesheets (no week entry), so they
// are permanently "not started" — excluding them keeps compliance metrics
// meaningful for the partners who actually file.
export const TIMESHEET_EXEMPT_ROLES: Role[] = ["finance_viewer", "leadership"];

export async function requirePeopleManager(): Promise<SessionUser> {
  return requireRole(["admin", "manager"]);
}

/** /week entry guard: read-only roles are redirected to the dashboard. */
export async function requireWeekEntryAccess(): Promise<SessionUser> {
  const user = await requireUser();
  if (isReadOnlyRole(user.role)) {
    redirect("/");
  }
  return user;
}

/** /projects guard: admins/managers get the full view, PMs the scoped view. */
export async function requireProjectsViewer(): Promise<SessionUser> {
  const user = await requireUser();
  if (!canViewProjectsAdmin(user.role)) {
    redirect("/");
  }
  return user;
}
