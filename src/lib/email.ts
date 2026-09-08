// Phase 6 (D5/D6): pure email builders — no DB, no nodemailer import here.
// The mailer transport layer (Phase D) consumes these; this module only
// renders templates and composes bodies so copy stays unit-testable and
// matches the in-app surfaces (reminders page, close exception report).

import type { ExceptionFlag } from "./close.ts";

/** Placeholders substituted by renderTemplate (contract documented in
 * settings.ts TEMPLATE_PLACEHOLDERS). Unknown placeholders are left as-is. */
export interface TemplateData {
  partner?: string;
  week?: string;
  due_date?: string;
  hours?: string | number;
}

const TEMPLATE_KEYS = ["partner", "week", "due_date", "hours"] as const;

export function renderTemplate(template: string, data: TemplateData): string {
  let out = template;
  for (const key of TEMPLATE_KEYS) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    out = out.replaceAll(`{${key}}`, String(value));
  }
  return out;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

const DEFAULT_SMTP_PORT = 587;

/** Parses SMTP config from an env-like object. Pure: the caller decides what
 * "env" is (process.env, a test fixture). Null when SMTP_HOST is unset or
 * blank — the log-only (would_send) mode signal per D5. */
export function smtpConfigFromEnv(
  env: Record<string, string | undefined>,
): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number.parseInt(env.SMTP_PORT ?? "", 10);
  return {
    host,
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_SMTP_PORT,
    user: env.SMTP_USER ?? "",
    pass: env.SMTP_PASS ?? "",
    from: env.SMTP_FROM ?? "",
  };
}

export interface ReminderEmailInput {
  partner: string;
  weekStartDate: string;
  deadline: string;
}

export interface EmailContent {
  subject: string;
  body: string;
}

/** Renders the admin-editable reminder templates (settings) for one
 * outstanding timesheet. Data keys match the documented placeholders. */
export function buildReminderEmail(
  templates: { subject: string; body: string },
  input: ReminderEmailInput,
): EmailContent {
  const data: TemplateData = {
    partner: input.partner,
    week: input.weekStartDate,
    due_date: input.deadline,
  };
  return {
    subject: renderTemplate(templates.subject, data),
    body: renderTemplate(templates.body, data),
  };
}

// Exception-report email mirrors the close page's exception table (partner,
// team, week, state, hours vs expected, flags) using the same labels.

const FLAG_LABELS: Record<ExceptionFlag, string> = {
  unsubmitted: "Unsubmitted",
  hours_outlier: "Hours outlier",
};

const STATE_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  in_correction: "In correction",
  approved: "Approved",
  locked: "Locked",
};

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 4) / 4;
  return `${rounded}h`;
}

export interface ExceptionEmailRow {
  name: string;
  team?: string | null;
  weekStartDate: string;
  state: string;
  totalHours: number;
  expectedHours: number;
  flags: ExceptionFlag[];
}

export interface ExceptionReportInput {
  fiscalYear: number;
  periodNumber: number;
  rows: ExceptionEmailRow[];
}

/** Builds the exception-report email distributed at close initiation (D6).
 * Rows use the exceptionFlags-style shape (close.ts) joined with display
 * fields, matching what the close page and export show. */
export function buildExceptionReportEmail(
  input: ExceptionReportInput,
): EmailContent {
  const period = `FY${input.fiscalYear} P${String(input.periodNumber).padStart(2, "0")}`;
  const subject = `Exception report — ${period} (${input.rows.length} flagged)`;

  if (input.rows.length === 0) {
    return {
      subject,
      body: `Pre-close exceptions for ${period}\n\nNo exceptions flagged.`,
    };
  }

  const lines = input.rows.map((row, index) => {
    const team = row.team ? ` (${row.team})` : "";
    const state = STATE_LABELS[row.state] ?? row.state;
    const flags =
      row.flags.length > 0
        ? row.flags.map((f) => FLAG_LABELS[f]).join(", ")
        : "—";
    return (
      `${index + 1}. ${row.name}${team} — week of ${row.weekStartDate}\n` +
      `   State: ${state} · Hours: ${formatHours(row.totalHours)} / ` +
      `expected ${formatHours(row.expectedHours)} · Flags: ${flags}`
    );
  });

  const body = [
    `Pre-close exceptions for ${period} — ${input.rows.length} flagged.`,
    "",
    ...lines,
    "",
    "Review these timesheets before finalizing the period close.",
  ].join("\n");

  return { subject, body };
}
