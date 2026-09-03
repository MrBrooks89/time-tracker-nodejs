import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
  image: text("image"),
  role: text("role", { enum: ["admin", "manager", "employee"] })
    .notNull()
    .default("employee"),
  isActive: integer("is_active", { mode: "boolean" })
    .notNull()
    .default(sql`1`),
  partnerCode: text("partner_code"),
  title: text("title"),
  team: text("team"),
  employmentType: text("employment_type", {
    enum: ["full_time", "part_time", "contractor"],
  })
    .notNull()
    .default("full_time"),
  standardWeeklyHours: real("standard_weekly_hours").notNull().default(40),
  managerId: text("manager_id").references((): AnySQLiteColumn => user.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp_ms",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp_ms",
  }),
  scope: text("scope"),
  password: text("password"),
  issuer: text("issuer"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const project = sqliteTable("project", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  number: integer("number").notNull().unique(),
  description: text("description"),
  projectManagerId: text("project_manager_id").references(() => user.id),
  costType: text("cost_type", {
    enum: ["capital", "operating", "mixed"],
  })
    .notNull()
    .default("operating"),
  isActive: integer("is_active", { mode: "boolean" })
    .notNull()
    .default(sql`1`),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const taskCode = sqliteTable("task_code", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
});

export const nonProjectCategory = sqliteTable("non_project_category", {
  id: text("id").primaryKey(),
  group: text("group").notNull(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
});

export const classificationRule = sqliteTable(
  "classification_rule",
  {
    id: text("id").primaryKey(),
    taskCodeId: text("task_code_id")
      .notNull()
      .references(() => taskCode.id),
    classification: text("classification", {
      enum: ["capex", "opex"],
    }).notNull(),
    effectiveFrom: text("effective_from").notNull(),
    notes: text("notes"),
  },
  (table) => [index("classification_rule_task_code_id_idx").on(table.taskCodeId)],
);

export const projectAssignment = sqliteTable(
  "project_assignment",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    assignedBy: text("assigned_by").references(() => user.id),
    assignedAt: integer("assigned_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    removedAt: integer("removed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("project_assignment_active_unique_idx")
      .on(table.userId, table.projectId)
      .where(sql`removed_at IS NULL`),
  ],
);

export const assignmentChange = sqliteTable("assignment_change", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  projectId: text("project_id").notNull(),
  changedBy: text("changed_by").notNull(),
  changeType: text("change_type", {
    enum: ["assigned", "unassigned"],
  }).notNull(),
  changedAt: integer("changed_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const fiscalPeriod = sqliteTable(
  "fiscal_period",
  {
    id: text("id").primaryKey(),
    fiscalYear: integer("fiscal_year").notNull(),
    quarter: integer("quarter").notNull(),
    periodNumber: integer("period_number").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    weekCount: integer("week_count").notNull(),
  },
  (table) => [
    uniqueIndex("fiscal_period_year_period_idx").on(
      table.fiscalYear,
      table.periodNumber,
    ),
  ],
);

export const holiday = sqliteTable("holiday", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  observedDate: text("observed_date").notNull().unique(),
});

export const timesheet = sqliteTable(
  "timesheet",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    weekStartDate: text("week_start_date").notNull(),
    state: text("state", {
      enum: ["not_started", "in_progress", "submitted", "in_correction", "locked"],
    })
      .notNull()
      .default("not_started"),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("timesheet_user_week_idx").on(table.userId, table.weekStartDate),
    index("timesheet_week_start_date_idx").on(table.weekStartDate),
  ],
);

export const timeEntry = sqliteTable(
  "time_entry",
  {
    id: text("id").primaryKey(),
    timesheetId: text("timesheet_id")
      .notNull()
      .references(() => timesheet.id, { onDelete: "cascade" }),
    entryDate: text("entry_date").notNull(),
    hours: real("hours").notNull(),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "set null",
    }),
    taskCodeId: text("task_code_id").references(() => taskCode.id),
    nonProjectCategoryId: text("non_project_category_id").references(
      () => nonProjectCategory.id,
    ),
    isHandsOn: integer("is_hands_on", { mode: "boolean" })
      .notNull()
      .default(sql`0`),
    resolvedClassification: text("resolved_classification", {
      enum: ["capex", "opex"],
    }).notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("time_entry_timesheet_id_idx").on(table.timesheetId),
    index("time_entry_entry_date_idx").on(table.entryDate),
  ],
);

export const favorite = sqliteTable(
  "favorite",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    taskCodeId: text("task_code_id")
      .notNull()
      .references(() => taskCode.id),
  },
  (table) => [
    uniqueIndex("favorite_user_project_task_idx").on(
      table.userId,
      table.projectId,
      table.taskCodeId,
    ),
  ],
);

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;
export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
export type TaskCode = typeof taskCode.$inferSelect;
export type NewTaskCode = typeof taskCode.$inferInsert;
export type NonProjectCategory = typeof nonProjectCategory.$inferSelect;
export type NewNonProjectCategory = typeof nonProjectCategory.$inferInsert;
export type ClassificationRule = typeof classificationRule.$inferSelect;
export type NewClassificationRule = typeof classificationRule.$inferInsert;
export type ProjectAssignment = typeof projectAssignment.$inferSelect;
export type NewProjectAssignment = typeof projectAssignment.$inferInsert;
export type AssignmentChange = typeof assignmentChange.$inferSelect;
export type NewAssignmentChange = typeof assignmentChange.$inferInsert;
export type FiscalPeriod = typeof fiscalPeriod.$inferSelect;
export type NewFiscalPeriod = typeof fiscalPeriod.$inferInsert;
export type Holiday = typeof holiday.$inferSelect;
export type NewHoliday = typeof holiday.$inferInsert;
export type Timesheet = typeof timesheet.$inferSelect;
export type NewTimesheet = typeof timesheet.$inferInsert;
export type TimeEntry = typeof timeEntry.$inferSelect;
export type NewTimeEntry = typeof timeEntry.$inferInsert;
export type Favorite = typeof favorite.$inferSelect;
export type NewFavorite = typeof favorite.$inferInsert;
