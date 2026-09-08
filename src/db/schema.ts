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
  role: text("role", {
    enum: [
      "admin",
      "manager",
      "employee",
      "finance_viewer",
      "leadership",
      "project_manager",
    ],
  })
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
      enum: [
        "not_started",
        "in_progress",
        "submitted",
        "in_correction",
        "approved",
        "locked",
      ],
    })
      .notNull()
      .default("not_started"),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    approvedBy: text("approved_by").references((): AnySQLiteColumn => user.id),
  },
  (table) => [
    uniqueIndex("timesheet_user_week_idx").on(table.userId, table.weekStartDate),
    index("timesheet_week_start_date_idx").on(table.weekStartDate),
  ],
);

// Insert-only audit trail: one row per approval decision (approve/reject),
// full history preserved. Rejection notes surface on the partner's week view.
export const timesheetDecision = sqliteTable(
  "timesheet_decision",
  {
    id: text("id").primaryKey(),
    timesheetId: text("timesheet_id")
      .notNull()
      .references(() => timesheet.id, { onDelete: "cascade" }),
    decision: text("decision", {
      enum: ["approve", "reject"],
    }).notNull(),
    decidedBy: text("decided_by")
      .notNull()
      .references(() => user.id),
    note: text("note"),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("timesheet_decision_timesheet_id_idx").on(table.timesheetId),
  ],
);

// One row per fiscal period once close is initiated; absence = open period.
// closedAt null → close initiated but not yet finalized.
export const periodClose = sqliteTable(
  "period_close",
  {
    id: text("id").primaryKey(),
    fiscalYear: integer("fiscal_year").notNull(),
    periodNumber: integer("period_number").notNull(),
    correctionWindowEndsAt: integer("correction_window_ends_at", {
      mode: "timestamp_ms",
    }),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    closedBy: text("closed_by").references(() => user.id),
    // Set when a locked period is corrected after finalize (TS-029):
    // reports compare entry updatedAt / correction timestamps against this
    // to badge data as "restated".
    restatedAt: integer("restated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("period_close_year_period_idx").on(
      table.fiscalYear,
      table.periodNumber,
    ),
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
    // Actor who created/edited the entry (TS-021/022 delegated entry).
    // Null for legacy rows created before delegation existed.
    enteredBy: text("entered_by").references((): AnySQLiteColumn => user.id),
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

// Unified append-only audit trail (DA-009): one row per notable action
// (entry edits, submissions, approvals, unlocks, corrections, reminders).
// Never updated or deleted — corrections add new rows, never rewrite history.
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_created_at_idx").on(table.createdAt),
  ],
);

// Locked-period corrections (TS-028): one row per admin correction applied to
// a time entry after its week was locked. `reason` is mandatory for
// compliance; original/new values are captured for the restating trail.
export const correctionLog = sqliteTable(
  "correction_log",
  {
    id: text("id").primaryKey(),
    timeEntryId: text("time_entry_id")
      .notNull()
      .references(() => timeEntry.id, { onDelete: "cascade" }),
    timesheetId: text("timesheet_id")
      .notNull()
      .references(() => timesheet.id, { onDelete: "cascade" }),
    correctedBy: text("corrected_by")
      .notNull()
      .references(() => user.id),
    reason: text("reason").notNull(),
    originalValue: text("original_value"),
    newValue: text("new_value"),
    correctedAt: integer("corrected_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("correction_log_time_entry_id_idx").on(table.timeEntryId),
    index("correction_log_timesheet_id_idx").on(table.timesheetId),
  ],
);

// Reminder records (TS-019/020): one row per partner reminded about an
// unsubmitted timesheet — in-app or email. `remindedBy` is null for
// scheduled sends (no acting admin); `trigger` + `weekStartDate` +
// `recipient` form the idempotency marker for scheduled sends (one per
// recipient per deadline day).
export const reminderLog = sqliteTable(
  "reminder_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    weekStartDate: text("week_start_date").notNull(),
    remindedBy: text("reminded_by").references(() => user.id),
    remindedAt: integer("reminded_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    note: text("note"),
    channel: text("channel", {
      enum: ["in_app", "email"],
    })
      .notNull()
      .default("in_app"),
    status: text("status", {
      enum: ["sent", "would_send", "failed"],
    })
      .notNull()
      .default("sent"),
    recipient: text("recipient"),
    trigger: text("trigger", {
      enum: ["manual", "scheduled"],
    })
      .notNull()
      .default("manual"),
  },
  (table) => [
    index("reminder_log_user_week_idx").on(table.userId, table.weekStartDate),
  ],
);

// Admin-configurable settings (NF-012): key/value store seeded with the
// src/lib/config.ts defaults; values are strings coerced by the settings
// reader (src/lib/settings-db.ts).
export const appSetting = sqliteTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Exception-report distribution (TS-025): insert-only, one row per recipient
// per close initiation. Log-only when SMTP is unconfigured (would_send).
export const distributionLog = sqliteTable(
  "distribution_log",
  {
    id: text("id").primaryKey(),
    closeId: text("close_id")
      .notNull()
      .references(() => periodClose.id, { onDelete: "cascade" }),
    recipientEmail: text("recipient_email").notNull(),
    recipientRole: text("recipient_role").notNull(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    status: text("status", {
      enum: ["sent", "would_send", "failed"],
    }).notNull(),
  },
  (table) => [index("distribution_log_close_id_idx").on(table.closeId)],
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
export type TimesheetDecision = typeof timesheetDecision.$inferSelect;
export type NewTimesheetDecision = typeof timesheetDecision.$inferInsert;
export type PeriodClose = typeof periodClose.$inferSelect;
export type NewPeriodClose = typeof periodClose.$inferInsert;
export type TimeEntry = typeof timeEntry.$inferSelect;
export type NewTimeEntry = typeof timeEntry.$inferInsert;
export type Favorite = typeof favorite.$inferSelect;
export type NewFavorite = typeof favorite.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
export type CorrectionLog = typeof correctionLog.$inferSelect;
export type NewCorrectionLog = typeof correctionLog.$inferInsert;
export type ReminderLog = typeof reminderLog.$inferSelect;
export type NewReminderLog = typeof reminderLog.$inferInsert;
export type AppSetting = typeof appSetting.$inferSelect;
export type NewAppSetting = typeof appSetting.$inferInsert;
export type DistributionLog = typeof distributionLog.$inferSelect;
export type NewDistributionLog = typeof distributionLog.$inferInsert;
