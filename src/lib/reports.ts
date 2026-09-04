import { and, asc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "@/db";
import {
  nonProjectCategory as categoryTable,
  project as projectTable,
  taskCode as taskCodeTable,
  timeEntry as timeEntryTable,
  timesheet as timesheetTable,
  user as userTable,
} from "@/db/schema";
import {
  FISCAL_PERIODS,
  currentWeek,
  findPeriod,
  isWeekStart,
  weekDates,
} from "@/lib/fiscal";
import type { SessionUser } from "@/lib/session";

// Aliased users table so entries can join the entry owner's manager
// without clashing with the primary userTable join.
const managerUser = alias(userTable, "manager_user");

export type ReportScope =
  | { kind: "week"; weekStartDate: string }
  | { kind: "period"; fiscalYear: number; periodNumber: number }
  | { kind: "quarter"; fiscalYear: number; quarter: number }
  | { kind: "year"; fiscalYear: number };

export interface ReportFilters {
  team?: string;
  managerId?: string;
  projectId?: string;
  userId?: string;
  categoryId?: string;
}

export function resolveScope(params: {
  week?: string;
  year?: string;
  period?: string;
  quarter?: string;
}): { scope: ReportScope; label: string; from: string; to: string } | null {
  if (params.week) {
    if (!isWeekStart(params.week)) return null;
    const period = findPeriod(params.week);
    if (!period) return null;
    return {
      scope: { kind: "week", weekStartDate: params.week },
      label: `Week of ${params.week}`,
      from: params.week,
      to: weekDates(params.week)[6],
    };
  }
  if (params.year && params.period) {
    const p = FISCAL_PERIODS.find(
      (row) =>
        row.fiscalYear === Number(params.year) &&
        row.periodNumber === Number(params.period),
    );
    if (!p) return null;
    return {
      scope: { kind: "period", fiscalYear: p.fiscalYear, periodNumber: p.periodNumber },
      label: `FY${p.fiscalYear} P${p.periodNumber}`,
      from: p.startDate,
      to: p.endDate,
    };
  }
  if (params.year && params.quarter) {
    const periods = FISCAL_PERIODS.filter(
      (row) =>
        row.fiscalYear === Number(params.year) &&
        row.quarter === Number(params.quarter),
    );
    if (periods.length === 0) return null;
    return {
      scope: { kind: "quarter", fiscalYear: periods[0].fiscalYear, quarter: periods[0].quarter },
      label: `FY${periods[0].fiscalYear} Q${periods[0].quarter}`,
      from: periods[0].startDate,
      to: periods[periods.length - 1].endDate,
    };
  }
  if (params.year) {
    const periods = FISCAL_PERIODS.filter((row) => row.fiscalYear === Number(params.year));
    if (periods.length === 0) return null;
    return {
      scope: { kind: "year", fiscalYear: periods[0].fiscalYear },
      label: `FY${periods[0].fiscalYear}`,
      from: periods[0].startDate,
      to: periods[periods.length - 1].endDate,
    };
  }

  const thisWeek = currentWeek();
  const period = findPeriod(thisWeek);
  if (!period) return null;
  return {
    scope: { kind: "period", fiscalYear: period.fiscalYear, periodNumber: period.periodNumber },
    label: `FY${period.fiscalYear} P${period.periodNumber}`,
    from: period.startDate,
    to: period.endDate,
  };
}

function scopeToDates(scope: ReportScope): { from: string; to: string } {
  if (scope.kind === "week") {
    return { from: scope.weekStartDate, to: weekDates(scope.weekStartDate)[6] };
  }
  const periods = FISCAL_PERIODS.filter((p) => {
    if (scope.kind === "period") {
      return p.fiscalYear === scope.fiscalYear && p.periodNumber === scope.periodNumber;
    }
    if (scope.kind === "quarter") {
      return p.fiscalYear === scope.fiscalYear && p.quarter === scope.quarter;
    }
    return p.fiscalYear === scope.fiscalYear;
  });
  return {
    from: periods[0].startDate,
    to: periods[periods.length - 1].endDate,
  };
}

export function priorPeriodOf(scope: ReportScope): ReportScope | null {
  if (scope.kind === "week") {
    return { kind: "week", weekStartDate: shiftWeek(scope.weekStartDate, -1) };
  }
  const sorted = [...FISCAL_PERIODS].sort(
    (a, b) => a.fiscalYear - b.fiscalYear || a.periodNumber - b.periodNumber,
  );
  if (scope.kind === "year") {
    const prevYear = sorted.filter((p) => p.fiscalYear === scope.fiscalYear - 1);
    if (prevYear.length === 0) return null;
    return { kind: "year", fiscalYear: scope.fiscalYear - 1 };
  }
  if (scope.kind === "quarter") {
    const prev = sorted.filter(
      (p) => p.fiscalYear === scope.fiscalYear && p.quarter === scope.quarter - 1,
    );
    if (prev.length > 0) {
      return { kind: "quarter", fiscalYear: scope.fiscalYear, quarter: scope.quarter - 1 };
    }
    const prevYear = sorted.filter((p) => p.fiscalYear === scope.fiscalYear - 1 && p.quarter === 4);
    if (prevYear.length === 0) return null;
    return { kind: "quarter", fiscalYear: scope.fiscalYear - 1, quarter: 4 };
  }
  const idx = sorted.findIndex(
    (p) => p.fiscalYear === scope.fiscalYear && p.periodNumber === scope.periodNumber,
  );
  if (idx <= 0) return null;
  const prev = sorted[idx - 1];
  return { kind: "period", fiscalYear: prev.fiscalYear, periodNumber: prev.periodNumber };
}

function shiftWeek(weekStartDate: string, n: number): string {
  const [y, m, d] = weekStartDate.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 7 * 86_400_000;
  const dt = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export interface ReportEntryRow {
  id: string;
  userName: string;
  team: string | null;
  managerId: string | null;
  managerName: string | null;
  projectName: string | null;
  taskCodeName: string | null;
  categoryName: string | null;
  entryDate: string;
  hours: number;
  classification: "capex" | "opex";
}

export async function getReportEntries(
  viewer: SessionUser,
  scope: ReportScope,
  filters: ReportFilters = {},
): Promise<ReportEntryRow[]> {
  const { from, to } = scopeToDates(scope);

  const conditions: SQL[] = [
    gte(timeEntryTable.entryDate, from),
    lte(timeEntryTable.entryDate, to),
    isNotNull(timesheetTable.id),
  ];

  if (viewer.role === "employee") {
    conditions.push(eq(timeEntryTable.timesheetId, timesheetTable.id));
    conditions.push(eq(timesheetTable.userId, viewer.id));
  }

  if (filters.userId) {
    conditions.push(eq(timesheetTable.userId, filters.userId));
  }
  if (filters.team) {
    conditions.push(eq(userTable.team, filters.team));
  }
  if (filters.managerId) {
    conditions.push(eq(userTable.managerId, filters.managerId));
  }
  if (filters.projectId) {
    conditions.push(eq(timeEntryTable.projectId, filters.projectId));
  }
  if (filters.categoryId) {
    conditions.push(eq(timeEntryTable.nonProjectCategoryId, filters.categoryId));
  }

  const rows = await db
    .select({
      id: timeEntryTable.id,
      userName: userTable.name,
      team: userTable.team,
      managerId: managerUser.id,
      managerName: managerUser.name,
      projectName: projectTable.name,
      taskCodeName: taskCodeTable.name,
      categoryName: categoryTable.name,
      entryDate: timeEntryTable.entryDate,
      hours: timeEntryTable.hours,
      classification: timeEntryTable.resolvedClassification,
    })
    .from(timeEntryTable)
    .innerJoin(timesheetTable, eq(timeEntryTable.timesheetId, timesheetTable.id))
    .innerJoin(userTable, eq(timesheetTable.userId, userTable.id))
    .leftJoin(managerUser, eq(userTable.managerId, managerUser.id))
    .leftJoin(projectTable, eq(timeEntryTable.projectId, projectTable.id))
    .leftJoin(taskCodeTable, eq(timeEntryTable.taskCodeId, taskCodeTable.id))
    .leftJoin(categoryTable, eq(timeEntryTable.nonProjectCategoryId, categoryTable.id))
    .where(and(...conditions))
    .orderBy(asc(timeEntryTable.entryDate), asc(userTable.name));

  return rows;
}

function summarize(entries: ReportEntryRow[]) {
  const total = entries.reduce((sum, e) => sum + e.hours, 0);
  const capex = entries
    .filter((e) => e.classification === "capex")
    .reduce((sum, e) => sum + e.hours, 0);
  const opex = entries
    .filter((e) => e.classification === "opex")
    .reduce((sum, e) => sum + e.hours, 0);
  return { total, capex, opex };
}

function groupBy<T extends string | null>(
  entries: ReportEntryRow[],
  key: (e: ReportEntryRow) => T,
  label: (e: ReportEntryRow) => string,
) {
  const map = new Map<string, { label: string; hours: number; entries: number; capex: number; opex: number }>();
  for (const entry of entries) {
    const k = key(entry) ?? "__none__";
    const row = map.get(k) ?? {
      label: label(entry),
      hours: 0,
      entries: 0,
      capex: 0,
      opex: 0,
    };
    row.hours += entry.hours;
    row.entries += 1;
    if (entry.classification === "capex") row.capex += entry.hours;
    else row.opex += entry.hours;
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours);
}

export interface ActualsReport {
  label: string;
  from: string;
  to: string;
  total: number;
  capex: number;
  opex: number;
  byPartner: Array<{ label: string; hours: number; entries: number }>;
  byProject: Array<{ label: string; hours: number; entries: number }>;
  byCategory: Array<{ label: string; hours: number; entries: number }>;
  byTaskCode: Array<{ label: string; hours: number; entries: number }>;
  prior: { label: string; total: number; capex: number; opex: number } | null;
  entries: ReportEntryRow[];
}

export async function getActualsReport(
  viewer: SessionUser,
  scope: ReportScope,
  label: string,
  filters: ReportFilters = {},
): Promise<ActualsReport> {
  const entries = await getReportEntries(viewer, scope, filters);
  const { total, capex, opex } = summarize(entries);

  let prior: ActualsReport["prior"] = null;
  const priorScope = priorPeriodOf(scope);
  if (priorScope) {
    const priorEntries = await getReportEntries(viewer, priorScope, filters);
    const priorSum = summarize(priorEntries);
    prior = {
      label:
        priorScope.kind === "week"
          ? `Week of ${priorScope.weekStartDate}`
          : priorScope.kind === "period"
            ? `FY${priorScope.fiscalYear} P${priorScope.periodNumber}`
            : priorScope.kind === "quarter"
              ? `FY${priorScope.fiscalYear} Q${priorScope.quarter}`
              : `FY${priorScope.fiscalYear}`,
      total: Math.round(priorSum.total * 4) / 4,
      capex: Math.round(priorSum.capex * 4) / 4,
      opex: Math.round(priorSum.opex * 4) / 4,
    };
  }

  const round = (v: number) => Math.round(v * 4) / 4;

  return {
    label,
    from: scopeToDates(scope).from,
    to: scopeToDates(scope).to,
    total: round(total),
    capex: round(capex),
    opex: round(opex),
    byPartner: groupBy(entries, (e) => e.userName, (e) => e.userName),
    byProject: groupBy(
      entries,
      (e) => e.projectName,
      (e) => e.projectName ?? "No project",
    ),
    byCategory: groupBy(
      entries,
      (e) => e.categoryName,
      (e) => e.categoryName ?? "—",
    ),
    byTaskCode: groupBy(
      entries,
      (e) => e.taskCodeName,
      (e) => e.taskCodeName ?? "—",
    ),
    prior,
    entries,
  };
}

export interface ComplianceReportRow {
  userId: string;
  name: string;
  team: string | null;
  weekStartDate: string;
  state: string;
  totalHours: number;
  submittedAt: string | null;
}

export async function getComplianceReport(
  viewer: SessionUser,
  scope: ReportScope,
): Promise<ComplianceReportRow[]> {
  let weeks: string[];
  if (scope.kind === "week") {
    weeks = [scope.weekStartDate];
  } else {
    const { from, to } = scopeToDates(scope);
    weeks = [];
    let cursor = from;
    while (cursor <= to && weeks.length < 60) {
      weeks.push(cursor);
      cursor = shiftWeek(cursor, 1);
    }
  }

  // Employees only see their own submission status; managers/admins see all active users.
  const userConditions = [eq(userTable.isActive, true)];
  if (viewer.role === "employee") {
    userConditions.push(eq(userTable.id, viewer.id));
  }

  const [users, sheets, totals] = await Promise.all([
    db
      .select({ id: userTable.id, name: userTable.name, team: userTable.team })
      .from(userTable)
      .where(and(...userConditions))
      .orderBy(asc(userTable.name)),
    db
      .select({
        id: timesheetTable.id,
        userId: timesheetTable.userId,
        weekStartDate: timesheetTable.weekStartDate,
        state: timesheetTable.state,
        submittedAt: timesheetTable.submittedAt,
      })
      .from(timesheetTable)
      .where(inArray(timesheetTable.weekStartDate, weeks)),
    db
      .select({
        timesheetId: timeEntryTable.timesheetId,
        totalHours: sql<number>`sum(${timeEntryTable.hours})`,
      })
      .from(timeEntryTable)
      .groupBy(timeEntryTable.timesheetId),
  ]);

  const sheetByUserWeek = new Map(
    sheets.map((s) => [`${s.userId}|${s.weekStartDate}`, s]),
  );
  const hoursBySheet = new Map(
    totals.map((t) => [t.timesheetId, Number(t.totalHours ?? 0)]),
  );

  const rows: ComplianceReportRow[] = [];
  for (const user of users) {
    for (const week of weeks) {
      const sheet = sheetByUserWeek.get(`${user.id}|${week}`);
      const state = sheet?.state ?? "not_started";
      rows.push({
        userId: user.id,
        name: user.name,
        team: user.team,
        weekStartDate: week,
        state,
        totalHours: sheet ? hoursBySheet.get(sheet.id) ?? 0 : 0,
        submittedAt: sheet?.submittedAt ? sheet.submittedAt.toISOString() : null,
      });
    }
  }
  return rows;
}

export interface ClassificationReport {
  byProject: Array<{
    projectName: string;
    taskCodeName: string;
    hours: number;
    capex: number;
    opex: number;
  }>;
  byTaskCode: Array<{ taskCodeName: string; hours: number; capex: number; opex: number }>;
  total: { hours: number; capex: number; opex: number };
  entries: ReportEntryRow[];
}

export async function getClassificationReport(
  viewer: SessionUser,
  scope: ReportScope,
  filters: ReportFilters = {},
): Promise<ClassificationReport> {
  const entries = await getReportEntries(viewer, scope, filters);

  const projectMap = new Map<
    string,
    { projectName: string; taskCodeName: string; hours: number; capex: number; opex: number }
  >();
  for (const entry of entries) {
    const key = `${entry.projectName ?? "No project"}|${entry.taskCodeName ?? "—"}`;
    const row = projectMap.get(key) ?? {
      projectName: entry.projectName ?? "No project",
      taskCodeName: entry.taskCodeName ?? "—",
      hours: 0,
      capex: 0,
      opex: 0,
    };
    row.hours += entry.hours;
    if (entry.classification === "capex") row.capex += entry.hours;
    else row.opex += entry.hours;
    projectMap.set(key, row);
  }

  const codeMap = new Map<string, { taskCodeName: string; hours: number; capex: number; opex: number }>();
  for (const entry of entries) {
    const key = entry.taskCodeName ?? "— (non-project)";
    const row = codeMap.get(key) ?? { taskCodeName: key, hours: 0, capex: 0, opex: 0 };
    row.hours += entry.hours;
    if (entry.classification === "capex") row.capex += entry.hours;
    else row.opex += entry.hours;
    codeMap.set(key, row);
  }

  const round = (v: number) => Math.round(v * 4) / 4;
  const total = summarize(entries);

  return {
    byProject: [...projectMap.values()].sort((a, b) => b.hours - a.hours),
    byTaskCode: [...codeMap.values()].sort((a, b) => b.hours - a.hours),
    total: { hours: round(total.total), capex: round(total.capex), opex: round(total.opex) },
    entries,
  };
}

export interface SpendDashboardData {
  current: { label: string; projectHours: number; supportHours: number; capex: number; opex: number; total: number };
  trend: Array<{ label: string; projectHours: number; supportHours: number; total: number }>;
  byTeam: Array<{ team: string; projectHours: number; supportHours: number; total: number }>;
  byManager: Array<{ manager: string; projectHours: number; supportHours: number; total: number }>;
}

export async function getSpendDashboard(
  viewer: SessionUser,
  filters: ReportFilters = {},
): Promise<SpendDashboardData> {
  const currentPeriod = findPeriod(currentWeek());
  const trendScopes: Array<{ label: string; scope: ReportScope }> = [];
  if (currentPeriod) {
    const sorted = [...FISCAL_PERIODS].sort(
      (a, b) => a.fiscalYear - b.fiscalYear || a.periodNumber - b.periodNumber,
    );
    const idx = sorted.findIndex(
      (p) =>
        p.fiscalYear === currentPeriod.fiscalYear &&
        p.periodNumber === currentPeriod.periodNumber,
    );
    for (let i = Math.max(0, idx - 4); i <= idx; i += 1) {
      trendScopes.push({
        label: `FY${sorted[i].fiscalYear} P${sorted[i].periodNumber}`,
        scope: { kind: "period", fiscalYear: sorted[i].fiscalYear, periodNumber: sorted[i].periodNumber },
      });
    }
  }

  const results = await Promise.all(
    trendScopes.map(async (t) => {
      const entries = await getReportEntries(viewer, t.scope, filters);
      const projectHours = entries
        .filter((e) => e.projectName !== null)
        .reduce((s, e) => s + e.hours, 0);
      const supportHours = entries
        .filter((e) => e.projectName === null)
        .reduce((s, e) => s + e.hours, 0);
      const capex = entries
        .filter((e) => e.classification === "capex")
        .reduce((s, e) => s + e.hours, 0);
      const opex = entries
        .filter((e) => e.classification === "opex")
        .reduce((s, e) => s + e.hours, 0);
      return {
        label: t.label,
        projectHours: Math.round(projectHours * 4) / 4,
        supportHours: Math.round(supportHours * 4) / 4,
        capex: Math.round(capex * 4) / 4,
        opex: Math.round(opex * 4) / 4,
      };
    }),
  );

  const current = results[results.length - 1] ?? {
    label: "—",
    projectHours: 0,
    supportHours: 0,
    capex: 0,
    opex: 0,
  };

  const latestScope = trendScopes[trendScopes.length - 1]?.scope;
  const teamRows: SpendDashboardData["byTeam"] = [];
  const managerRows: SpendDashboardData["byManager"] = [];

  if (latestScope) {
    const entries = await getReportEntries(viewer, latestScope, filters);
    const teamMap = new Map<string, { projectHours: number; supportHours: number }>();
    for (const e of entries) {
      const key = e.team ?? "Unassigned";
      const row = teamMap.get(key) ?? { projectHours: 0, supportHours: 0 };
      if (e.projectName !== null) row.projectHours += e.hours;
      else row.supportHours += e.hours;
      teamMap.set(key, row);
    }
    for (const [team, row] of teamMap) {
      teamRows.push({
        team,
        projectHours: Math.round(row.projectHours * 4) / 4,
        supportHours: Math.round(row.supportHours * 4) / 4,
        total: Math.round((row.projectHours + row.supportHours) * 4) / 4,
      });
    }
    teamRows.sort((a, b) => b.total - a.total);

    // Group the same viewer-scoped entries by manager, mirroring the team
    // grouping above so employees never see other managers' team totals.
    const managerMap = new Map<string, { projectHours: number; supportHours: number }>();
    for (const e of entries) {
      const key = e.managerName ?? "Unassigned";
      const row = managerMap.get(key) ?? { projectHours: 0, supportHours: 0 };
      if (e.projectName !== null) row.projectHours += e.hours;
      else row.supportHours += e.hours;
      managerMap.set(key, row);
    }
    for (const [manager, row] of managerMap) {
      managerRows.push({
        manager,
        projectHours: Math.round(row.projectHours * 4) / 4,
        supportHours: Math.round(row.supportHours * 4) / 4,
        total: Math.round((row.projectHours + row.supportHours) * 4) / 4,
      });
    }
    managerRows.sort((a, b) => b.total - a.total);
  }

  return {
    current: { ...current, total: current.projectHours + current.supportHours },
    trend: results.map((r) => ({
      label: r.label,
      projectHours: r.projectHours,
      supportHours: r.supportHours,
      total: r.projectHours + r.supportHours,
    })),
    byTeam: teamRows,
    byManager: managerRows,
  };
}

export interface ReportOptions {
  teams: string[];
  managers: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; number: number }>;
  users: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
}

export async function getReportOptions(): Promise<ReportOptions> {
  const [teams, projects, users, categories, actualManagers] = await Promise.all([
    db
      .selectDistinct({ team: userTable.team })
      .from(userTable)
      .where(isNotNull(userTable.team)),
    db
      .select({ id: projectTable.id, name: projectTable.name, number: projectTable.number })
      .from(projectTable)
      .orderBy(asc(projectTable.name)),
    db
      .select({ id: userTable.id, name: userTable.name })
      .from(userTable)
      .where(eq(userTable.isActive, true))
      .orderBy(asc(userTable.name)),
    db
      .select({ id: categoryTable.id, name: categoryTable.name })
      .from(categoryTable)
      .orderBy(asc(categoryTable.name)),
    db
      .selectDistinct({ id: userTable.id, name: userTable.name })
      .from(userTable)
      .where(isNotNull(userTable.managerId))
      .orderBy(asc(userTable.name)),
  ]);

  return {
    teams: teams.map((t) => t.team).filter((t): t is string => t !== null).sort(),
    managers: actualManagers,
    projects,
    users,
    categories,
  };
}

export function csvEscape(value: string): string {
  // Guard against CSV formula injection (=, +, -, @ prefixes) while leaving
  // plain numbers (including negative decimals like -0.25) untouched.
  const guarded =
    /^[=+\-@]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value)
      ? `'${value}`
      : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}
