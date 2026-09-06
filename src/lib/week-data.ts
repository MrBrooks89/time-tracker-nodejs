import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  favorite as favoriteTable,
  holiday as holidayTable,
  nonProjectCategory as categoryTable,
  project as projectTable,
  projectAssignment as assignmentTable,
  taskCode as taskCodeTable,
  classificationRule as ruleTable,
  timeEntry as timeEntryTable,
  timesheet as timesheetTable,
  timesheetDecision as decisionTable,
  user as userTable,
} from "@/db/schema";
import {
  addWeeks,
  currentWeek,
  findWeek,
  weekDates,
  weekEnterable,
  type FiscalWeekInfo,
} from "@/lib/fiscal";
import { deadlineForWeek, expectedHours } from "@/lib/holidays";

export interface TaskCodeInfo {
  id: string;
  name: string;
  description: string;
  classification: "capex" | "opex" | null;
  notes: string | null;
}

export interface CategoryInfo {
  id: string;
  group: string;
  name: string;
  description: string;
}

export interface AssignmentInfo {
  projectId: string;
  projectName: string;
  projectNumber: number;
}

export interface FavoriteInfo {
  id: string;
  projectId: string;
  projectName: string;
  projectNumber: number;
  taskCodeId: string;
  taskCodeName: string;
}

export interface WeekRow {
  key: string;
  projectId: string | null;
  taskCodeId: string | null;
  nonProjectCategoryId: string | null;
  isHandsOn: boolean;
  note: string | null;
  days: Record<string, number>;
}

export interface WeekData {
  week: FiscalWeekInfo;
  weekStartDate: string;
  dates: string[];
  state:
    | "not_started"
    | "in_progress"
    | "submitted"
    | "in_correction"
    | "approved"
    | "locked";
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  latestRejectionNote: string | null;
  rows: WeekRow[];
  totalHours: number;
  standardWeeklyHours: number;
  expectedHours: number;
  deadline: string;
  holidaysInWeek: Array<{ name: string; date: string }>;
  enterable: boolean;
  rowProjectNames: Record<string, string>;
}

export async function getTaskCodes(): Promise<TaskCodeInfo[]> {
  const today = new Date().toISOString().slice(0, 10);
  const [codes, rules] = await Promise.all([
    db.select().from(taskCodeTable).orderBy(taskCodeTable.name),
    db.select().from(ruleTable),
  ]);

  return codes.map((code) => {
    const applicable = rules
      .filter((r) => r.taskCodeId === code.id && r.effectiveFrom <= today)
      .sort((a, b) => (a.effectiveFrom > b.effectiveFrom ? 1 : -1));
    const latest = applicable[applicable.length - 1] ?? null;
    return {
      id: code.id,
      name: code.name,
      description: code.description,
      classification: latest ? latest.classification : null,
      notes: latest ? latest.notes : null,
    };
  });
}

export async function getCategories(): Promise<CategoryInfo[]> {
  const rows = await db
    .select()
    .from(categoryTable)
    .orderBy(categoryTable.group, categoryTable.name);
  return rows.map((row) => ({
    id: row.id,
    group: row.group,
    name: row.name,
    description: row.description,
  }));
}

export async function getActiveAssignments(userId: string): Promise<AssignmentInfo[]> {
  const rows = await db
    .select({
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectNumber: projectTable.number,
    })
    .from(assignmentTable)
    .innerJoin(projectTable, eq(assignmentTable.projectId, projectTable.id))
    .where(
      and(
        eq(assignmentTable.userId, userId),
        isNull(assignmentTable.removedAt),
        eq(projectTable.isActive, true),
      ),
    )
    .orderBy(projectTable.name);
  return rows;
}

export async function getFavorites(userId: string): Promise<FavoriteInfo[]> {
  const rows = await db
    .select({
      id: favoriteTable.id,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectNumber: projectTable.number,
      taskCodeId: taskCodeTable.id,
      taskCodeName: taskCodeTable.name,
    })
    .from(favoriteTable)
    .innerJoin(projectTable, eq(favoriteTable.projectId, projectTable.id))
    .innerJoin(taskCodeTable, eq(favoriteTable.taskCodeId, taskCodeTable.id))
    .where(eq(favoriteTable.userId, userId))
    .orderBy(projectTable.name);
  return rows;
}

export async function getWeekData(
  userId: string,
  weekStartDate: string,
): Promise<WeekData | null> {
  const week = findWeek(weekStartDate);
  if (!week) return null;

  const dates = weekDates(weekStartDate);

  const [sheet, userRow, holidays] = await Promise.all([
    db
      .select()
      .from(timesheetTable)
      .where(
        and(
          eq(timesheetTable.userId, userId),
          eq(timesheetTable.weekStartDate, weekStartDate),
        ),
      )
      .limit(1),
    db
      .select({ standardWeeklyHours: userTable.standardWeeklyHours })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1),
    db
      .select({ name: holidayTable.name, date: holidayTable.observedDate })
      .from(holidayTable)
      .where(
        and(
          gte(holidayTable.observedDate, dates[0]),
          lte(holidayTable.observedDate, dates[6]),
        ),
      ),
  ]);

  const entries = sheet[0]
    ? await db
        .select({
          entryDate: timeEntryTable.entryDate,
          hours: timeEntryTable.hours,
          projectId: timeEntryTable.projectId,
          taskCodeId: timeEntryTable.taskCodeId,
          nonProjectCategoryId: timeEntryTable.nonProjectCategoryId,
          isHandsOn: timeEntryTable.isHandsOn,
          note: timeEntryTable.note,
        })
        .from(timeEntryTable)
        .where(eq(timeEntryTable.timesheetId, sheet[0].id))
    : [];

  // Latest rejection note surfaces on the partner's week view (D4). Only
  // reject decisions carry notes; approve rows are filtered out here.
  const latestRejection = sheet[0]
    ? await db
        .select({ note: decisionTable.note })
        .from(decisionTable)
        .where(
          and(
            eq(decisionTable.timesheetId, sheet[0].id),
            eq(decisionTable.decision, "reject"),
          ),
        )
        .orderBy(desc(decisionTable.decidedAt))
        .limit(1)
    : [];

  const allHolidayDates = (
    await db.select({ date: holidayTable.observedDate }).from(holidayTable)
  ).map((h) => h.date);

  const standardWeeklyHours = userRow[0]?.standardWeeklyHours ?? 40;

  const projectIds = [...new Set(entries.map((e) => e.projectId).filter((v): v is string => v !== null))];
  const taskCodeIds = [...new Set(entries.map((e) => e.taskCodeId).filter((v): v is string => v !== null))];
  const categoryIds = [...new Set(entries.map((e) => e.nonProjectCategoryId).filter((v): v is string => v !== null))];

  const [projects, codes, cats] = await Promise.all([
    projectIds.length
      ? db.select({ id: projectTable.id, name: projectTable.name }).from(projectTable).where(inArray(projectTable.id, projectIds))
      : Promise.resolve([]),
    taskCodeIds.length
      ? db.select({ id: taskCodeTable.id, name: taskCodeTable.name }).from(taskCodeTable).where(inArray(taskCodeTable.id, taskCodeIds))
      : Promise.resolve([]),
    categoryIds.length
      ? db.select({ id: categoryTable.id, name: categoryTable.name }).from(categoryTable).where(inArray(categoryTable.id, categoryIds))
      : Promise.resolve([]),
  ]);

  const rowProjectNames: Record<string, string> = {};
  const rowCodeNames: Record<string, string> = {};
  const rowCategoryNames: Record<string, string> = {};
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const codeMap = new Map(codes.map((c) => [c.id, c.name]));
  const categoryMap = new Map(cats.map((c) => [c.id, c.name]));

  const rows = new Map<string, WeekRow>();
  let totalHours = 0;

  for (const entry of entries) {
    const key = [
      entry.projectId ?? "np",
      entry.taskCodeId ?? "",
      entry.nonProjectCategoryId ?? "",
      entry.isHandsOn ? "h" : "n",
    ].join("|");
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        projectId: entry.projectId,
        taskCodeId: entry.taskCodeId,
        nonProjectCategoryId: entry.nonProjectCategoryId,
        isHandsOn: entry.isHandsOn,
        note: entry.note,
        days: {},
      };
      rows.set(key, row);
      if (entry.projectId) {
        rowProjectNames[entry.projectId] = projectMap.get(entry.projectId) ?? "Unknown project";
      }
      if (entry.taskCodeId) {
        rowCodeNames[entry.taskCodeId] = codeMap.get(entry.taskCodeId) ?? "Unknown code";
      }
      if (entry.nonProjectCategoryId) {
        rowCategoryNames[entry.nonProjectCategoryId] = categoryMap.get(entry.nonProjectCategoryId) ?? "Unknown category";
      }
    }
    row.days[entry.entryDate] = (row.days[entry.entryDate] ?? 0) + entry.hours;
    totalHours += entry.hours;
  }

  return {
    week,
    weekStartDate,
    dates,
    state: sheet[0]?.state ?? "not_started",
    submittedAt: sheet[0]?.submittedAt ? sheet[0].submittedAt.toISOString() : null,
    approvedAt: sheet[0]?.approvedAt ? sheet[0].approvedAt.toISOString() : null,
    approvedBy: sheet[0]?.approvedBy ?? null,
    latestRejectionNote: latestRejection[0]?.note ?? null,
    rows: [...rows.values()],
    totalHours: Math.round(totalHours * 4) / 4,
    standardWeeklyHours,
    expectedHours: expectedHours(weekStartDate, standardWeeklyHours, allHolidayDates),
    deadline: deadlineForWeek(weekStartDate, allHolidayDates),
    holidaysInWeek: holidays,
    enterable: weekEnterable(weekStartDate),
    rowProjectNames,
  };
}

export interface ComplianceRow {
  userId: string;
  name: string;
  team: string | null;
  weekStartDate: string;
  state: string;
  deadline: string;
}

export async function getOutstandingWeeksBack(weeksBack = 4): Promise<{
  current: string;
  weeks: Array<{ weekStartDate: string; deadline: string }>;
}> {
  const allHolidayDates = (
    await db.select({ date: holidayTable.observedDate }).from(holidayTable)
  ).map((h) => h.date);

  const now = currentWeek();
  const weeks: Array<{ weekStartDate: string; deadline: string }> = [];
  for (let i = weeksBack; i >= 1; i -= 1) {
    const ws = addWeeks(now, -i);
    const deadline = deadlineForWeek(ws, allHolidayDates);
    const deadlinePassed = deadline < new Date().toISOString().slice(0, 10);
    if (deadlinePassed) {
      weeks.push({ weekStartDate: ws, deadline });
    }
  }
  return { current: now, weeks };
}

export async function getOwnOutstandingWeeks(userId: string): Promise<
  Array<{ weekStartDate: string; state: string; deadline: string }>
> {
  const { weeks } = await getOutstandingWeeksBack(4);
  if (weeks.length === 0) return [];

  const sheets = await db
    .select({ weekStartDate: timesheetTable.weekStartDate, state: timesheetTable.state })
    .from(timesheetTable)
    .where(
      and(
        eq(timesheetTable.userId, userId),
        inArray(
          timesheetTable.weekStartDate,
          weeks.map((w) => w.weekStartDate),
        ),
      ),
    );

  const stateByWeek = new Map(sheets.map((s) => [s.weekStartDate, s.state]));
  return weeks
    .filter((w) => {
      const state = stateByWeek.get(w.weekStartDate) ?? "not_started";
      return state === "not_started" || state === "in_progress";
    })
    .map((w) => ({
      weekStartDate: w.weekStartDate,
      deadline: w.deadline,
      state: stateByWeek.get(w.weekStartDate) ?? "not_started",
    }));
}

export async function getComplianceSnapshot(weeksBack = 4): Promise<ComplianceRow[]> {
  const { weeks } = await getOutstandingWeeksBack(weeksBack);
  if (weeks.length === 0) return [];

  const weekDates = weeks.map((w) => w.weekStartDate);

  const [users, sheets] = await Promise.all([
    db
      .select({ id: userTable.id, name: userTable.name, team: userTable.team })
      .from(userTable)
      .where(eq(userTable.isActive, true))
      .orderBy(userTable.name),
    db
      .select({
        userId: timesheetTable.userId,
        weekStartDate: timesheetTable.weekStartDate,
        state: timesheetTable.state,
      })
      .from(timesheetTable)
      .where(inArray(timesheetTable.weekStartDate, weekDates)),
  ]);

  const stateByUserWeek = new Map(
    sheets.map((s) => [`${s.userId}|${s.weekStartDate}`, s.state]),
  );

  const rows: ComplianceRow[] = [];
  for (const user of users) {
    for (const week of weeks) {
      const state = stateByUserWeek.get(`${user.id}|${week.weekStartDate}`) ?? "not_started";
      if (state === "not_started" || state === "in_progress") {
        rows.push({
          userId: user.id,
          name: user.name,
          team: user.team,
          weekStartDate: week.weekStartDate,
          state,
          deadline: week.deadline,
        });
      }
    }
  }
  return rows;
}

export interface ApprovalQueueRow {
  userId: string;
  name: string;
  team: string | null;
  weekStartDate: string;
  totalHours: number;
  expectedHours: number;
  submittedAt: string | null;
  deadline: string;
}

// Queue rules (D2/D3): managers see direct reports; admins additionally see
// self-managed (managerId = own id) and unmanaged (managerId null) partners.
// Self-approval is always blocked, so the viewer's own sheets never appear.
export async function getApprovalQueue(viewer: {
  id: string;
  role: "admin" | "manager" | "employee";
}): Promise<ApprovalQueueRow[]> {
  // Admins additionally own self-managed (managerId = own id) and unmanaged
  // (managerId null) partners; managers only see direct reports. and()
  // accepts undefined entries, so the admin/manager split stays one clause.
  const ownerFilter =
    viewer.role === "admin"
      ? or(
          eq(userTable.managerId, viewer.id),
          isNull(userTable.managerId),
          eq(userTable.managerId, userTable.id),
        )
      : eq(userTable.managerId, viewer.id);

  const [sheets, holidays] = await Promise.all([
    db
      .select({
        userId: userTable.id,
        name: userTable.name,
        team: userTable.team,
        standardWeeklyHours: userTable.standardWeeklyHours,
        weekStartDate: timesheetTable.weekStartDate,
        submittedAt: timesheetTable.submittedAt,
        totalHours: sql<number>`coalesce(sum(${timeEntryTable.hours}), 0)`,
      })
      .from(timesheetTable)
      .innerJoin(userTable, eq(timesheetTable.userId, userTable.id))
      .leftJoin(timeEntryTable, eq(timeEntryTable.timesheetId, timesheetTable.id))
      .where(
        and(
          eq(timesheetTable.state, "submitted"),
          eq(userTable.isActive, true),
          ne(userTable.id, viewer.id),
          ownerFilter,
        ),
      )
      .groupBy(
        userTable.id,
        userTable.name,
        userTable.team,
        userTable.standardWeeklyHours,
        timesheetTable.weekStartDate,
        timesheetTable.submittedAt,
      )
      .orderBy(timesheetTable.weekStartDate, userTable.name),
    db.select({ date: holidayTable.observedDate }).from(holidayTable),
  ]);

  const holidayDates = holidays.map((h) => h.date);

  return sheets.map((sheet) => ({
    userId: sheet.userId,
    name: sheet.name,
    team: sheet.team,
    weekStartDate: sheet.weekStartDate,
    totalHours: Math.round(Number(sheet.totalHours) * 4) / 4,
    expectedHours: expectedHours(
      sheet.weekStartDate,
      sheet.standardWeeklyHours,
      holidayDates,
    ),
    submittedAt: sheet.submittedAt ? sheet.submittedAt.toISOString() : null,
    deadline: deadlineForWeek(sheet.weekStartDate, holidayDates),
  }));
}

// Latest sheet the partner still has in correction (D4), with the most recent
// rejection note. Drives the dashboard "action needed" indicator — covers
// past weeks too, not just the current one.
export async function getOwnLatestCorrection(
  userId: string,
): Promise<{ weekStartDate: string; note: string | null } | null> {
  const [sheet] = await db
    .select({ id: timesheetTable.id, weekStartDate: timesheetTable.weekStartDate })
    .from(timesheetTable)
    .where(
      and(
        eq(timesheetTable.userId, userId),
        eq(timesheetTable.state, "in_correction"),
      ),
    )
    .orderBy(desc(timesheetTable.weekStartDate))
    .limit(1);
  if (!sheet) return null;

  const [decision] = await db
    .select({ note: decisionTable.note })
    .from(decisionTable)
    .where(
      and(
        eq(decisionTable.timesheetId, sheet.id),
        eq(decisionTable.decision, "reject"),
      ),
    )
    .orderBy(desc(decisionTable.decidedAt))
    .limit(1);

  return { weekStartDate: sheet.weekStartDate, note: decision?.note ?? null };
}
