import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildExceptionReportEmail,
  buildReminderEmail,
  renderTemplate,
  smtpConfigFromEnv,
} from "./email.ts";
import type { ExceptionFlag } from "./close.ts";

test("renderTemplate substitutes all documented placeholders", () => {
  assert.equal(
    renderTemplate("Hi {partner}, week {week} due {due_date}, {hours}h logged", {
      partner: "Jane Doe",
      week: "2026-09-02",
      due_date: "2026-09-14",
      hours: 32.5,
    }),
    "Hi Jane Doe, week 2026-09-02 due 2026-09-14, 32.5h logged",
  );
});

test("renderTemplate replaces repeated placeholders", () => {
  assert.equal(
    renderTemplate("{week}…{week}", { week: "2026-09-02" }),
    "2026-09-02…2026-09-02",
  );
});

test("renderTemplate leaves unknown placeholders as-is", () => {
  assert.equal(
    renderTemplate("Hello {name}, {partner} / {unknown_key}", {
      partner: "Jane Doe",
    }),
    "Hello {name}, Jane Doe / {unknown_key}",
  );
});

test("renderTemplate leaves placeholders whose data is missing", () => {
  assert.equal(
    renderTemplate("Hi {partner}, due {due_date}", { partner: "Jane" }),
    "Hi Jane, due {due_date}",
  );
});

test("smtpConfigFromEnv: null when SMTP_HOST is unset or blank", () => {
  assert.equal(smtpConfigFromEnv({}), null);
  assert.equal(smtpConfigFromEnv({ SMTP_HOST: "" }), null);
  assert.equal(smtpConfigFromEnv({ SMTP_HOST: "   " }), null);
  assert.equal(
    smtpConfigFromEnv({ SMTP_PORT: "2525", SMTP_FROM: "x@y.z" }),
    null,
  );
});

test("smtpConfigFromEnv: full config from env values", () => {
  assert.deepEqual(
    smtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_USER: "mailer",
      SMTP_PASS: "secret",
      SMTP_FROM: "timesheets@example.com",
    }),
    {
      host: "smtp.example.com",
      port: 465,
      user: "mailer",
      pass: "secret",
      from: "timesheets@example.com",
    },
  );
});

test("smtpConfigFromEnv: port defaults to 587 when unset or invalid", () => {
  assert.equal(smtpConfigFromEnv({ SMTP_HOST: "smtp.example.com" })?.port, 587);
  assert.equal(
    smtpConfigFromEnv({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "abc" })
      ?.port,
    587,
  );
  assert.equal(
    smtpConfigFromEnv({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "-1" })
      ?.port,
    587,
  );
  assert.equal(
    smtpConfigFromEnv({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "0" })?.port,
    587,
  );
});

test("smtpConfigFromEnv: missing user/pass/from default to empty strings", () => {
  assert.deepEqual(
    smtpConfigFromEnv({ SMTP_HOST: "smtp.example.com" }),
    {
      host: "smtp.example.com",
      port: 587,
      user: "",
      pass: "",
      from: "",
    },
  );
});

const defaultSubject = () => "Timesheet reminder — week of {week} due {due_date}";
const defaultBody = () =>
  "Hi {partner},\n\nYour timesheet for the week of {week} is due by {due_date}. Please submit it so the period close can proceed.\n\n— Time Tracker";

test("buildReminderEmail renders subject and body from templates", () => {
  const email = buildReminderEmail(
    {
      subject: defaultSubject(),
      body: defaultBody(),
    },
    {
      partner: "Jane Doe",
      weekStartDate: "2026-09-02",
      deadline: "2026-09-14",
    },
  );
  assert.equal(email.subject, "Timesheet reminder — week of 2026-09-02 due 2026-09-14");
  assert.ok(email.body.startsWith("Hi Jane Doe,"));
  assert.ok(email.body.includes("week of 2026-09-02 is due by 2026-09-14"));
});

test("buildReminderEmail passes through unmatched placeholders", () => {
  const email = buildReminderEmail(
    { subject: "Due {due_date} for {hours}h", body: "b" },
    { partner: "Jane", weekStartDate: "2026-09-02", deadline: "2026-09-14" },
  );
  assert.equal(email.subject, "Due 2026-09-14 for {hours}h");
});

const exceptionRow = (
  overrides: Partial<{
    name: string;
    team: string | null;
    weekStartDate: string;
    state: string;
    totalHours: number;
    expectedHours: number;
    flags: ExceptionFlag[];
  }> = {},
) => ({
  name: "Jane Doe",
  team: "Platform",
  weekStartDate: "2026-09-02",
  state: "submitted",
  totalHours: 5,
  expectedHours: 40,
  flags: ["hours_outlier"] as ExceptionFlag[],
  ...overrides,
});

test("buildExceptionReportEmail: subject carries period and flagged count", () => {
  const email = buildExceptionReportEmail({
    fiscalYear: 2026,
    periodNumber: 3,
    rows: [exceptionRow(), exceptionRow({ name: "Bob", flags: ["unsubmitted"] })],
  });
  assert.equal(email.subject, "Exception report — FY2026 P03 (2 flagged)");
});

test("buildExceptionReportEmail: body mirrors the close-page exception table", () => {
  const email = buildExceptionReportEmail({
    fiscalYear: 2026,
    periodNumber: 12,
    rows: [
      exceptionRow(),
      exceptionRow({
        name: "Bob Smith",
        team: null,
        state: "not_started",
        totalHours: 0,
        flags: ["unsubmitted"],
      }),
      exceptionRow({
        name: "Cara",
        flags: ["unsubmitted", "hours_outlier"],
      }),
    ],
  });
  assert.ok(email.body.includes("Pre-close exceptions for FY2026 P12 — 3 flagged."));
  assert.ok(email.body.includes("1. Jane Doe (Platform) — week of 2026-09-02"));
  assert.ok(email.body.includes("State: Submitted · Hours: 5h / expected 40h · Flags: Hours outlier"));
  assert.ok(email.body.includes("2. Bob Smith — week of 2026-09-02"));
  assert.ok(email.body.includes("State: Not started"));
  assert.ok(email.body.includes("Flags: Unsubmitted"));
  assert.ok(email.body.includes("Flags: Unsubmitted, Hours outlier"));
  assert.ok(email.body.includes("Review these timesheets before finalizing the period close."));
});

test("buildExceptionReportEmail: quarter-rounded hours", () => {
  const email = buildExceptionReportEmail({
    fiscalYear: 2026,
    periodNumber: 1,
    rows: [exceptionRow({ totalHours: 32.3, expectedHours: 40.25 })],
  });
  // 32.3 rounds to the quarter → 32.25 (same rounding as the close export).
  assert.ok(email.body.includes("Hours: 32.25h / expected 40.25h"));
});

test("buildExceptionReportEmail: empty rows produce a no-exceptions body", () => {
  const email = buildExceptionReportEmail({
    fiscalYear: 2026,
    periodNumber: 1,
    rows: [],
  });
  assert.equal(email.subject, "Exception report — FY2026 P01 (0 flagged)");
  assert.equal(
    email.body,
    "Pre-close exceptions for FY2026 P01\n\nNo exceptions flagged.",
  );
});
