import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { db } from "./index.ts";
import {
  account as accountTable,
  assignmentChange as assignmentChangeTable,
  classificationRule as classificationRuleTable,
  favorite as favoriteTable,
  fiscalPeriod as fiscalPeriodTable,
  holiday as holidayTable,
  nonProjectCategory as nonProjectCategoryTable,
  project as projectTable,
  projectAssignment as projectAssignmentTable,
  taskCode as taskCodeTable,
  timeEntry as timeEntryTable,
  timesheet as timesheetTable,
  user as userTable,
  verification as verificationTable,
  session as sessionTable,
  type NewTimeEntry,
  type NewTimesheet,
} from "./schema.ts";

interface PartnerData {
  name: string;
  title: string;
  team: string;
  partnerCode: string;
  email: string;
  employment: string;
  status: string;
}

interface ProjectData {
  name: string;
  number: number;
  status: string;
  notes: string;
  projectManager: string;
}

interface TaskCodeData {
  name: string;
  description: string;
}

interface CategoryData {
  group: string;
  name: string;
  description: string;
}

interface RuleData {
  taskCode: string;
  classification: "capex" | "opex";
  notes: string;
}

interface FiscalPeriodData {
  fiscalYear: number;
  quarter: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  weekCount: number;
}

interface Dataset {
  partners: PartnerData[];
  projects: ProjectData[];
  taskCodes: TaskCodeData[];
  nonProjectCategories: CategoryData[];
  classificationRules: RuleData[];
  fiscalPeriods: FiscalPeriodData[];
  expectedHolidays: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Date helpers (all dates treated as plain YYYY-MM-DD strings, UTC-safe)
// ---------------------------------------------------------------------------

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

/** Day of week: 0=Sun … 6=Sat */
function dayOfWeek(date: Date): number {
  return date.getUTCDay();
}

/** Wednesday-aligned week start for the week containing `date`. */
function weekStartOf(dateStr: string): string {
  const date = parseDate(dateStr);
  const offset = (dayOfWeek(date) - 3 + 7) % 7; // Wed=3
  return formatDate(addDays(date, -offset));
}

// ---------------------------------------------------------------------------
// Holiday observance rules
// ---------------------------------------------------------------------------

/** Fixed-date holiday: Mon–Fri → that day, Sat → prior Friday, Sun → next Monday. */
function observedFixed(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dow = date.getUTCDay();
  if (dow === 6) return formatDate(addDays(date, -1));
  if (dow === 0) return formatDate(addDays(date, 1));
  return formatDate(date);
}

/** n-th `weekday` (0=Sun) of month. */
function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  nth: number,
): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return formatDate(new Date(Date.UTC(year, month - 1, 1 + offset + (nth - 1) * 7)));
}

/** Last `weekday` (0=Sun) of month. */
function lastWeekday(year: number, month: number, weekday: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0));
  const offset = (lastDay.getUTCDay() - weekday + 7) % 7;
  return formatDate(new Date(Date.UTC(year, month - 1, lastDay.getUTCDate() - offset)));
}

interface HolidayPlan {
  name: string;
  observedDate: string;
}

function computeHolidays(year: number): HolidayPlan[] {
  return [
    { name: "New Year's Day", observedDate: observedFixed(year, 1, 1) },
    { name: "Memorial Day", observedDate: lastWeekday(year, 5, 1) },
    { name: "Independence Day", observedDate: observedFixed(year, 7, 4) },
    { name: "Labor Day", observedDate: nthWeekday(year, 9, 1, 1) },
    { name: "Thanksgiving", observedDate: nthWeekday(year, 11, 4, 4) },
    { name: "Christmas", observedDate: observedFixed(year, 12, 25) },
  ];
}

// ---------------------------------------------------------------------------
// Insert batching
// ---------------------------------------------------------------------------

async function insertBatched<T extends Record<string, unknown>>(
  insert: (rows: T[]) => Promise<unknown>,
  rows: T[],
  batchSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    await insert(rows.slice(i, i + batchSize));
  }
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed() {
  const datasetPath = join(process.cwd(), "data", "hackathon-dataset.json");
  const dataset: Dataset = JSON.parse(readFileSync(datasetPath, "utf8"));

  // -- 1. Wipe tables in FK-safe order --------------------------------------
  await db.delete(timeEntryTable);
  await db.delete(timesheetTable);
  await db.delete(favoriteTable);
  await db.delete(assignmentChangeTable);
  await db.delete(projectAssignmentTable);
  await db.delete(classificationRuleTable);
  await db.delete(taskCodeTable);
  await db.delete(nonProjectCategoryTable);
  await db.delete(holidayTable);
  await db.delete(fiscalPeriodTable);
  await db.delete(accountTable);
  await db.delete(sessionTable);
  await db.delete(verificationTable);
  await db.delete(projectTable);
  await db.delete(userTable);

  // -- 2. Partners (users + credential accounts) -----------------------------
  const passwordHash = await hashPassword("hackathon2026");
  const now = new Date();

  const adminEmail = "aaron.alvarez@hackathon.com";
  const managerEmails = new Set([
    "fatima.kim@hackathon.com",
    "christian.diaz@hackathon.com",
  ]);

  function roleFor(email: string): "admin" | "manager" | "employee" {
    if (email === adminEmail) return "admin";
    if (managerEmails.has(email)) return "manager";
    return "employee";
  }

  interface SeededUser {
    id: string;
    index: number;
    partner: PartnerData;
    isActive: boolean;
    managerId: string | null;
    role: "admin" | "manager" | "employee";
  }

  // Manager synthesis: per team (active partners considered as candidates),
  // first dataset-order member with Manager/Supervisor/Lead in title,
  // else alphabetically first member.
  const byTeam = new Map<string, PartnerData[]>();
  for (const partner of dataset.partners) {
    const list = byTeam.get(partner.team) ?? [];
    list.push(partner);
    byTeam.set(partner.team, list);
  }

  const managerEmailByTeam = new Map<string, string>();
  for (const [team, members] of byTeam) {
    const activeMembers = members.filter((m) => m.status === "active");
    const pool = activeMembers.length > 0 ? activeMembers : members;
    const picked =
      pool.find((m) => /Manager|Supervisor|Lead/i.test(m.title)) ??
      [...pool].sort((a, b) => a.name.localeCompare(b.name))[0];
    managerEmailByTeam.set(team, picked.email);
  }

  const users: SeededUser[] = [];
  const userRows: Array<typeof userTable.$inferInsert> = [];
  const accountRows: Array<typeof accountTable.$inferInsert> = [];

  dataset.partners.forEach((partner, index) => {
    const id = randomUUID();
    const teamManagerEmail = managerEmailByTeam.get(partner.team);
    users.push({
      id,
      index,
      partner,
      isActive: partner.status === "active",
      managerId: null,
      role: roleFor(partner.email),
    });
    userRows.push({
      id,
      name: partner.name,
      email: partner.email.toLowerCase(),
      emailVerified: false,
      role: roleFor(partner.email),
      isActive: partner.status === "active",
      partnerCode: partner.partnerCode,
      title: partner.title,
      team: partner.team,
      employmentType:
        partner.employment === "contractor"
          ? "contractor"
          : partner.employment === "part_time"
            ? "part_time"
            : "full_time",
      standardWeeklyHours: partner.employment === "contractor" ? 24 : 40,
      createdAt: now,
      updatedAt: now,
    });
    accountRows.push({
      id: randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: passwordHash,
      issuer: "local:credential",
      createdAt: now,
      updatedAt: now,
    });
    if (teamManagerEmail === partner.email) {
      // placeholder; resolved to real id below
      users[users.length - 1].managerId = null;
    }
  });

  const idByEmail = new Map(users.map((u) => [u.partner.email, u.id]));
  for (const u of users) {
    const teamManagerEmail = managerEmailByTeam.get(u.partner.team);
    u.managerId = teamManagerEmail === u.partner.email ? null : idByEmail.get(teamManagerEmail!) ?? null;
  }

  await insertBatched((rows) => db.insert(userTable).values(rows), userRows);
  await insertBatched((rows) => db.insert(accountTable).values(rows), accountRows);

  const activeUsers = users.filter((u) => u.isActive);
  const inactiveUsers = users.filter((u) => !u.isActive);
  const admin = users.find((u) => u.partner.email === adminEmail)!;

  // -- 3. Projects -----------------------------------------------------------
  const projectIdByNumber = new Map<number, string>();
  const projectRows: Array<typeof projectTable.$inferInsert> = dataset.projects.map(
    (project) => {
      const id = randomUUID();
      projectIdByNumber.set(project.number, id);
      const pmId = idByEmail.get(
        dataset.partners.find((p) => p.name === project.projectManager)?.email ?? "",
      );
      const costType = (["capital", "operating", "mixed"] as const)[
        project.number % 3
      ];
      return {
        id,
        number: project.number,
        name: project.name,
        description: project.notes,
        projectManagerId: pmId ?? null,
        costType,
        isActive: project.status === "active",
        createdAt: now,
        updatedAt: now,
      };
    },
  );
  await insertBatched((rows) => db.insert(projectTable).values(rows), projectRows);

  const activeProjectIds = dataset.projects
    .filter((p) => p.status === "active")
    .map((p) => projectIdByNumber.get(p.number)!);
  const allProjectIds = dataset.projects.map(
    (p) => projectIdByNumber.get(p.number)!,
  );

  // -- 4. Task codes + non-project categories --------------------------------
  const taskCodeIdByName = new Map<string, string>();
  const taskCodeRows: Array<typeof taskCodeTable.$inferInsert> =
    dataset.taskCodes.map((tc) => {
      const id = randomUUID();
      taskCodeIdByName.set(tc.name, id);
      return { id, name: tc.name, description: tc.description };
    });
  await db.insert(taskCodeTable).values(taskCodeRows);

  const categoryIdByName = new Map<string, string>();
  const categoryRows: Array<typeof nonProjectCategoryTable.$inferInsert> =
    dataset.nonProjectCategories.map((c) => {
      const id = randomUUID();
      categoryIdByName.set(c.name, id);
      return { id, group: c.group, name: c.name, description: c.description };
    });
  await db.insert(nonProjectCategoryTable).values(categoryRows);

  // -- 5. Classification rules ----------------------------------------------
  const ruleByTaskCodeName = new Map<string, RuleData>();
  const ruleRows: Array<typeof classificationRuleTable.$inferInsert> =
    dataset.classificationRules.map((rule) => {
      ruleByTaskCodeName.set(rule.taskCode, rule);
      return {
        id: randomUUID(),
        taskCodeId: taskCodeIdByName.get(rule.taskCode)!,
        classification: rule.classification,
        effectiveFrom: "2025-10-01",
        notes: rule.notes,
      };
    });
  await db.insert(classificationRuleTable).values(ruleRows);

  function classificationFor(
    taskCodeName: string,
    isHandsOn: boolean,
  ): "capex" | "opex" {
    const rule = ruleByTaskCodeName.get(taskCodeName);
    if (!rule) throw new Error(`No classification rule for ${taskCodeName}`);
    if (taskCodeName === "Manager Oversight" && isHandsOn) return "capex";
    return rule.classification;
  }

  // -- 6. Fiscal periods ------------------------------------------------------
  const periodRows: Array<typeof fiscalPeriodTable.$inferInsert> =
    dataset.fiscalPeriods.map((p) => ({
      id: randomUUID(),
      fiscalYear: p.fiscalYear,
      quarter: p.quarter,
      periodNumber: p.periodNumber,
      startDate: p.startDate,
      endDate: p.endDate,
      weekCount: p.weekCount,
    }));
  await db.insert(fiscalPeriodTable).values(periodRows);

  // -- 7. Holidays ------------------------------------------------------------
  const holidayPlans: HolidayPlan[] = [];
  for (const year of [2025, 2026, 2027]) {
    holidayPlans.push(...computeHolidays(year));
  }
  const computedHolidays = new Map(
    holidayPlans.map((h) => [h.observedDate, h.name]),
  );
  const expectedEntries = Object.entries(dataset.expectedHolidays);
  for (const [expectedDate, expectedName] of expectedEntries) {
    const computedName = computedHolidays.get(expectedDate);
    if (computedName !== expectedName) {
      throw new Error(
        `Holiday mismatch for ${expectedDate}: computed=${computedName ?? "none"} expected=${expectedName}`,
      );
    }
  }
  for (const date of computedHolidays.keys()) {
    if (dataset.expectedHolidays[date] === undefined) {
      // Computed holidays outside the 14 validated entries (e.g. Jul 4 2025,
      // Memorial Day 2025) are still real observances within 2025–2027.
    }
  }
  const holidayRows: Array<typeof holidayTable.$inferInsert> = holidayPlans.map(
    (h) => ({ id: randomUUID(), name: h.name, observedDate: h.observedDate }),
  );
  await db.insert(holidayTable).values(holidayRows);

  const holidayDates = new Set(computedHolidays.keys());

  // -- 8. Project assignments + change log -----------------------------------
  const adminId = admin.id;

  // Active partners: 2–4 active projects each, deterministic arithmetic.
  // Special case (TC-014): Ana Bell must not be assigned project #24
  // (Fuel System Compliance) — she gets projects #11, #13, #17 explicitly.
  const fuelComplianceId = projectIdByNumber.get(24)!;
  const bellProjectIds = [11, 13, 17].map((n) => projectIdByNumber.get(n)!);

  interface AssignmentPlan {
    userId: string;
    projectId: string;
    removedAt: Date | null;
  }

  const assignmentPlans: AssignmentPlan[] = [];
  const changeRows: Array<typeof assignmentChangeTable.$inferInsert> = [];

  for (const u of activeUsers) {
    const assignmentCount = 2 + (u.index % 3);
    let picked: string[];
    if (u.partner.email === "ana.bell@hackathon.com") {
      picked = bellProjectIds;
    } else {
      picked = [];
      for (let k = 0; k < assignmentCount; k++) {
        const idx = (u.index * 7 + k * 3) % activeProjectIds.length;
        const projectId = activeProjectIds[idx];
        if (!picked.includes(projectId)) picked.push(projectId);
      }
      // ensure at least 2 distinct
      let k = 0;
      while (picked.length < 2) {
        const idx = (u.index * 7 + k * 5 + 11) % activeProjectIds.length;
        const projectId = activeProjectIds[idx];
        if (!picked.includes(projectId)) picked.push(projectId);
        k++;
      }
    }
    for (const projectId of picked) {
      assignmentPlans.push({
        userId: u.id,
        projectId,
        removedAt: null,
      });
      changeRows.push({
        id: randomUUID(),
        userId: u.id,
        projectId,
        changedBy: adminId,
        changeType: "assigned",
        changedAt: now,
      });
    }
  }

  // Inactive partners: 2 historical (removed) assignments each.
  for (const u of inactiveUsers) {
    for (let k = 0; k < 2; k++) {
      const idx = (u.index * 7 + k * 3) % allProjectIds.length;
      assignmentPlans.push({
        userId: u.id,
        projectId: allProjectIds[idx],
        removedAt: new Date(now.getTime() - 90 * 86400000),
      });
    }
  }

  await insertBatched(
    (rows) => db.insert(projectAssignmentTable).values(rows),
    assignmentPlans.map((a) => ({
      id: randomUUID(),
      userId: a.userId,
      projectId: a.projectId,
      assignedBy: adminId,
      assignedAt: a.removedAt
        ? new Date(a.removedAt.getTime() - 30 * 86400000)
        : now,
      removedAt: a.removedAt,
    })),
  );
  await insertBatched((rows) => db.insert(assignmentChangeTable).values(rows), changeRows);

  const assignedProjectIdsByUser = new Map<string, string[]>();
  for (const a of assignmentPlans) {
    if (a.removedAt !== null) continue;
    const list = assignedProjectIdsByUser.get(a.userId) ?? [];
    list.push(a.projectId);
    assignedProjectIdsByUser.set(a.userId, list);
  }

  // -- 9. Historical timesheets + entries -------------------------------------
  // Weeks: FY26 P7–P11 fiscal weeks (Apr 8 2026 → Sep 1 2026) + current week.
  const historicalPeriods = dataset.fiscalPeriods.filter(
    (p) => p.fiscalYear === 2026 && p.periodNumber >= 7 && p.periodNumber <= 11,
  );
  const historicalWeeks: string[] = [];
  for (const period of historicalPeriods) {
    let weekStart = weekStartOf(period.startDate);
    const end = parseDate(period.endDate);
    while (parseDate(weekStart) <= end) {
      historicalWeeks.push(weekStart);
      weekStart = formatDate(addDays(parseDate(weekStart), 7));
    }
  }
  const currentWeekStart = weekStartOf("2026-09-02"); // "2026-09-02"

  // Deadline = Monday after week end, shifted to prior Friday if that Monday
  // is an observed holiday. Week runs Wed..Tue; the following Monday is
  // weekStart + 6 (Tue) + 6 days = weekStart + 12.
  function deadlineFor(weekStartDate: string): Date {
    const mondayAfter = addDays(parseDate(weekStartDate), 12);
    if (holidayDates.has(formatDate(mondayAfter))) {
      return addDays(mondayAfter, -3); // prior Friday
    }
    return mondayAfter;
  }

  const taskCodeNames = dataset.taskCodes.map((tc) => tc.name);
  const taskCodeIds = taskCodeNames.map((n) => taskCodeIdByName.get(n)!);

  const nonProjectCommon = ["Administrative", "Production Support", "Support - Meetings"];
  const nonProjectCommonIds = nonProjectCommon.map((n) => categoryIdByName.get(n)!);
  const businessEnhancementsId = categoryIdByName.get("Business Enhancements")!;

  const timesheetRows: NewTimesheet[] = [];
  const entryRows: NewTimeEntry[] = [];

  function addEntry(
    timesheetId: string,
    entryDate: string,
    hours: number,
    opts: {
      projectId?: string | null;
      taskCodeName?: string | null;
      categoryId?: string | null;
      isHandsOn?: boolean;
      note?: string | null;
    },
  ): void {
    const isHandsOn = opts.isHandsOn ?? false;
    let resolved: "capex" | "opex";
    if (opts.categoryId) {
      resolved = "opex";
    } else {
      resolved = classificationFor(opts.taskCodeName!, isHandsOn);
    }
    entryRows.push({
      id: randomUUID(),
      timesheetId,
      entryDate,
      hours,
      projectId: opts.projectId ?? null,
      taskCodeId: opts.taskCodeName ? taskCodeIdByName.get(opts.taskCodeName)! : null,
      nonProjectCategoryId: opts.categoryId ?? null,
      isHandsOn,
      resolvedClassification: resolved,
      note: opts.note ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  function weekdaysOf(weekStartDate: string): string[] {
    const days: string[] = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = formatDate(addDays(parseDate(weekStartDate), d));
      const dow = dayOfWeek(parseDate(dateStr));
      if (dow >= 1 && dow <= 5 && !holidayDates.has(dateStr)) {
        days.push(dateStr);
      }
    }
    return days;
  }

  for (const u of activeUsers) {
    const projectIds = assignedProjectIdsByUser.get(u.id) ?? [];
    if (projectIds.length === 0) continue;
    const stdHours = u.partner.employment === "contractor" ? 24 : 40;
    const isLightWeekPartner = u.index % 7 === 3;
    const isCurrentWeekPartner = u.index % 5 === 0;
    const missingP11Week = u.index % 11 === 5;
    const lastP11Week = (() => {
      const p11 = dataset.fiscalPeriods.find(
        (p) => p.fiscalYear === 2026 && p.periodNumber === 11,
      )!;
      return formatDate(addDays(parseDate(p11.endDate), -6));
    })();

    for (let w = 0; w < historicalWeeks.length; w++) {
      const weekStartDate = historicalWeeks[w];
      if (missingP11Week && weekStartDate === lastP11Week) continue;

      const timesheetId = randomUUID();
      const deadline = deadlineFor(weekStartDate);
      const submittedAt = new Date(
        deadline.getTime() + 9 * 3600000, // 9:00 on deadline day
      );
      timesheetRows.push({
        id: timesheetId,
        userId: u.id,
        weekStartDate,
        state: "submitted",
        submittedAt,
      });

      const days = weekdaysOf(weekStartDate);
      const light = isLightWeekPartner && w % 3 === 0;
      const weeklyTarget = light ? 20 : stdHours;
      void weeklyTarget;
      let dayCounter = 0;

      for (const day of days) {
        dayCounter++;
        // Project row: 6h (or 4h light) with rotating task code
        const projectHours = light ? 4 : 6;
        const taskIdx = (u.index + w * 2 + dayCounter) % taskCodeIds.length;
        let taskCodeName: string | null = taskCodeNames[taskIdx];
        let isHandsOn = false;

        if (taskCodeName === "Manager Oversight") {
          // ~10% of weeks include Manager Oversight; keep for this partner-week
          // only on some weeks so it stays rare overall.
          if ((u.index + w) % 10 !== 0) {
            taskCodeName = taskCodeNames[(taskIdx + 1) % taskCodeNames.length];
          } else if ((u.index + w) % 40 === 0) {
            isHandsOn = true; // ~1/4 of Manager Oversight weeks
          }
        }

        const projectId = projectIds[(u.index + dayCounter) % projectIds.length];
        addEntry(timesheetId, day, projectHours, {
          projectId,
          taskCodeName,
          isHandsOn,
        });

        // Non-project row: 2h (light weeks: 0h → skip)
        if (!light) {
          const catIdx = (u.index + w + dayCounter) % nonProjectCommonIds.length;
          const useEnhancements =
            (u.index + w) % 9 === 0 && dayCounter === 2;
          addEntry(timesheetId, day, 2, {
            categoryId: useEnhancements
              ? businessEnhancementsId
              : nonProjectCommonIds[catIdx],
          });
        }
      }

      // pad up to per-day target if rounding lost hours (skip — totals are approximate)
    }

    if (isCurrentWeekPartner) {
      const timesheetId = randomUUID();
      timesheetRows.push({
        id: timesheetId,
        userId: u.id,
        weekStartDate: currentWeekStart,
        state: "in_progress",
        submittedAt: null,
      });
      const days = weekdaysOf(currentWeekStart).slice(0, 2);
      let dayCounter = 0;
      for (const day of days) {
        dayCounter++;
        const projectId = projectIds[u.index % projectIds.length];
        const taskIdx = (u.index + dayCounter) % taskCodeIds.length;
        addEntry(timesheetId, day, 6, {
          projectId,
          taskCodeName: taskCodeNames[taskIdx],
        });
        addEntry(timesheetId, day, 2, {
          categoryId: nonProjectCommonIds[dayCounter % nonProjectCommonIds.length],
        });
      }
    }
  }

  // Inactive partners: 3 submitted weeks in P7 (Apr 8 – May 5 2026).
  const p7 = dataset.fiscalPeriods.find(
    (p) => p.fiscalYear === 2026 && p.periodNumber === 7,
  )!;
  const p7Weeks: string[] = [];
  {
    let ws = weekStartOf(p7.startDate);
    while (parseDate(ws) <= parseDate(p7.endDate)) {
      p7Weeks.push(ws);
      ws = formatDate(addDays(parseDate(ws), 7));
    }
  }
  const inactiveProjectId = projectIdByNumber.get(31)!; // Delivery Route Optimization

  for (const u of inactiveUsers) {
    const myAssignments = assignmentPlans.filter((a) => a.userId === u.id);
    const projectIds = myAssignments.map((a) => a.projectId);
    for (let w = 0; w < 3; w++) {
      const weekStartDate = p7Weeks[w % p7Weeks.length];
      const timesheetId = randomUUID();
      const deadline = deadlineFor(weekStartDate);
      timesheetRows.push({
        id: timesheetId,
        userId: u.id,
        weekStartDate,
        state: "submitted",
        submittedAt: new Date(deadline.getTime() + 9 * 3600000),
      });
      const days = weekdaysOf(weekStartDate);
      let dayCounter = 0;
      for (const day of days.slice(0, 4)) {
        dayCounter++;
        const projectId = projectIds[(w + dayCounter) % projectIds.length];
        const taskIdx = (u.index + w + dayCounter) % taskCodeIds.length;
        addEntry(timesheetId, day, 7, {
          projectId,
          taskCodeName: taskCodeNames[taskIdx],
        });
        addEntry(timesheetId, day, 1, {
          categoryId: nonProjectCommonIds[(u.index + dayCounter) % nonProjectCommonIds.length],
        });
      }
    }
  }

  // TC-028: an active partner logs an entry against inactive project #31 in P7.
  {
    const u = activeUsers[0];
    const weekStartDate = p7Weeks[0];
    const existing = timesheetRows.some(
      (t) => t.userId === u.id && t.weekStartDate === weekStartDate,
    );
    if (existing) {
      // activeUsers[0] already has this week; instead log the #31 entry into
      // that existing timesheet.
      const ts = timesheetRows.find(
        (t) => t.userId === u.id && t.weekStartDate === weekStartDate,
      )!;
      const days = weekdaysOf(weekStartDate);
      addEntry(ts.id!, days[0], 1, {
        projectId: inactiveProjectId,
        taskCodeName: "Project Support",
        note: "Route analysis wrap-up",
      });
    } else {
      const timesheetId = randomUUID();
      const deadline = deadlineFor(weekStartDate);
      timesheetRows.push({
        id: timesheetId,
        userId: u.id,
        weekStartDate,
        state: "submitted",
        submittedAt: new Date(deadline.getTime() + 9 * 3600000),
      });
      const days = weekdaysOf(weekStartDate);
      addEntry(timesheetId, days[0], 6, {
        projectId: inactiveProjectId,
        taskCodeName: "Project Support",
      });
      addEntry(timesheetId, days[0], 2, {
        categoryId: nonProjectCommonIds[0],
      });
      let dayCounter = 0;
      for (const day of days.slice(1)) {
        dayCounter++;
        addEntry(timesheetId, day, 6, {
          projectId: (assignedProjectIdsByUser.get(u.id) ?? [inactiveProjectId])[0],
          taskCodeName: taskCodeNames[(dayCounter + 1) % taskCodeIds.length],
        });
        addEntry(timesheetId, day, 2, {
          categoryId: nonProjectCommonIds[dayCounter % nonProjectCommonIds.length],
        });
      }
    }
  }

  await insertBatched((rows) => db.insert(timesheetTable).values(rows), timesheetRows);
  await insertBatched((rows) => db.insert(timeEntryTable).values(rows), entryRows);

  // -- 10. Favorites -----------------------------------------------------------
  const favoriteRows: Array<typeof favoriteTable.$inferInsert> = [];
  let favCount = 0;
  for (const u of activeUsers) {
    if (favCount >= 10) break;
    if (u.index % 13 !== 0) continue;
    const projectIds = assignedProjectIdsByUser.get(u.id) ?? [];
    if (projectIds.length === 0) continue;
    favoriteRows.push({
      id: randomUUID(),
      userId: u.id,
      projectId: projectIds[0],
      taskCodeId: taskCodeIdByName.get("Develop & Configure")!,
    });
    favCount++;
  }
  if (favoriteRows.length > 0) {
    await db.insert(favoriteTable).values(favoriteRows);
  }

  // -- 11. Reconciliation ------------------------------------------------------
  const [userCount] = await db.select({ value: count() }).from(userTable);
  const [activeCount] = await db
    .select({ value: count() })
    .from(userTable)
    .where(eq(userTable.isActive, true));
  const roleRows = await db
    .select({ role: userTable.role, value: count() })
    .from(userTable)
    .groupBy(userTable.role);
  const [projectCount] = await db.select({ value: count() }).from(projectTable);
  const [taskCodeCount] = await db.select({ value: count() }).from(taskCodeTable);
  const [categoryCount] = await db
    .select({ value: count() })
    .from(nonProjectCategoryTable);
  const [ruleCount] = await db.select({ value: count() }).from(classificationRuleTable);
  const [periodCount] = await db.select({ value: count() }).from(fiscalPeriodTable);
  const [holidayCount] = await db.select({ value: count() }).from(holidayTable);
  const [assignmentCount] = await db
    .select({ value: count() })
    .from(projectAssignmentTable);
  const stateRows = await db
    .select({ state: timesheetTable.state, value: count() })
    .from(timesheetTable)
    .groupBy(timesheetTable.state);
  const [entryCount] = await db.select({ value: count() }).from(timeEntryTable);
  const hoursRow = await db
    .select({
      total: sql<number>`coalesce(sum(${timeEntryTable.hours}), 0)`,
    })
    .from(timeEntryTable);
  const totalHours = Number(hoursRow[0]?.total ?? 0);
  const dateRows = await db
    .selectDistinct({ entryDate: timeEntryTable.entryDate })
    .from(timeEntryTable)
    .orderBy(timeEntryTable.entryDate);

  console.log("=== Seed reconciliation ===");
  console.log(`Users: ${userCount?.value} (active ${activeCount?.value})`);
  for (const r of roleRows) console.log(`  role ${r.role}: ${r.value}`);
  console.log(`Projects: ${projectCount?.value}`);
  console.log(`Task codes: ${taskCodeCount?.value}`);
  console.log(`Non-project categories: ${categoryCount?.value}`);
  console.log(`Classification rules: ${ruleCount?.value}`);
  console.log(`Fiscal periods: ${periodCount?.value}`);
  console.log(`Holidays: ${holidayCount?.value}`);
  console.log(`Project assignments: ${assignmentCount?.value}`);
  for (const r of stateRows) console.log(`  timesheet ${r.state}: ${r.value}`);
  console.log(`Time entries: ${entryCount?.value}`);
  console.log(`Total hours: ${totalHours}`);
  console.log(
    `Distinct entry dates: ${dateRows.length} (min ${dateRows[0]?.entryDate} max ${dateRows[dateRows.length - 1]?.entryDate})`,
  );

  // TC-oriented assertions
  const [ana] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, "ana.bell@hackathon.com"))
    .limit(1);
  const anaAssignments = await db
    .select({ projectId: projectAssignmentTable.projectId })
    .from(projectAssignmentTable)
    .where(eq(projectAssignmentTable.userId, ana!.id));
  if (anaAssignments.some((a) => a.projectId === fuelComplianceId)) {
    throw new Error("TC-014 violated: Ana Bell is assigned to Fuel System Compliance");
  }
  console.log("TC-014 OK: Ana Bell not assigned to project #24");

  const [firstInactive] = inactiveUsers;
  const inactiveEntries = await db
    .select({ id: timeEntryTable.id })
    .from(timeEntryTable)
    .innerJoin(timesheetTable, eq(timeEntryTable.timesheetId, timesheetTable.id))
    .where(eq(timesheetTable.userId, firstInactive.id))
    .limit(1);
  if (inactiveEntries.length === 0) {
    throw new Error("Expected inactive partner to have historical entries");
  }
  console.log(`TC-002 OK: inactive partner ${firstInactive.partner.name} has historical entries`);

  const [p31Entry] = await db
    .select({ id: timeEntryTable.id })
    .from(timeEntryTable)
    .where(eq(timeEntryTable.projectId, inactiveProjectId))
    .limit(1);
  if (!p31Entry) {
    throw new Error("Expected an entry against inactive project #31");
  }
  console.log("TC-028 OK: entry exists against project #31");
}

seed()
  .then(() => {
    console.log("Seed complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
