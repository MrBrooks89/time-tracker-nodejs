# Time Tracker

A role-based weekly time-tracking application built for an IT hackathon. Employees log
hours against projects and non-project categories, managers/admins manage people and
assignments, and everyone can report on actuals, compliance, and capex/opex classification
across a 4-4-5 fiscal calendar.

## Features

- **Weekly timesheets** — grid entry per day with project/task-code or non-project
  categories, hands-on flags, and notes
- **Favorites** — pin/unpin project/task-code combos (star toggle) for quick entry
  in the week grid
- **Delegated entry** — admins can open and edit any partner's week on their behalf;
  every delegated save/submit is attributed via `enteredBy` and the audit trail
- **Holiday pre-population** — observed holidays auto-insert an adjustable Out of
  Office entry when the week opens
- **Timesheet state machine** — `not_started → in_progress → submitted → in_correction → approved → locked`
- **Approval workflow** — managers/admins review submitted weeks in an approval queue;
  rejection sends the sheet back to the partner for correction. No self-approval —
  managers' own sheets and unmanaged partners route to admin. Every decision is kept
  in an insert-only audit trail
- **Capex/opex classification** — task-code rules resolve each entry's classification,
  with effective dates
- **Fiscal calendar** — FY26–FY27 4-4-5-style periods (12 periods/year) with holiday
  observance logic; admins can maintain holidays and generate future-year periods
- **Roles & permissions** — admin, manager, employee, plus finance_viewer,
  leadership, and project_manager (Section 1.4); managers/admins manage people
  and project assignments, project managers manage their own project teams
- **Reports** — Time Spend, Period Actuals, Compliance, and CapEx/Opex tabs, each
exportable as CSV or XLSX; restated periods show an as-of "Restated" badge
- **Period close cycle** — admins initiate a fiscal-period close: exception report
  (unsubmitted weeks, hours outliers) → correction window (5 business days) → finalize
  (sheets lock) → reopen if needed
- **Locked-period corrections** — admins can correct locked weeks with a mandatory
  reason; every correction is logged (correction + audit trail) and marks the
  period as restated
- **Audit trail** — append-only log of entries, submissions, approvals, close
  events, people/project changes, and corrections; admin audit viewer at `/audit`
- **Reminders** — deadline-derived list of unsubmitted due/past-due timesheets
  with an admin ad-hoc reminder trigger, history, and CSV export; email
  delivery via configurable SMTP (log-only `would_send` mode when SMTP is
  not configured), admin-editable subject/body templates, and an automatic
  deadline-day send (lazy on first navigation + a cron entry point at
  `/api/reminders/run`)
- **AI classification helper** — advisory CapEx/OpEx suggestions in the week
  grid (Vercel AI SDK + AI Gateway). Clear-cut task codes echo the
  deterministic rule with no model call; judgment calls (Manager Oversight,
  high-hours Business Enhancements) stream a suggestion with confidence and
  explanation. Suggestions are advisory only — they never change the stored
  classification, and the helper hides itself entirely when no
  `AI_GATEWAY_API_KEY` is configured
- **Admin settings** — tolerances (max hours/day, hours-outlier threshold,
  correction-window length), reminder templates, and the AI model string are
  admin-configurable at `/settings` with no code change; every change is
  audit-logged
- **Exception-report distribution** — initiating a period close emails the
  exception report to the managers of flagged partners and the PMs of
  affected projects (log-only when SMTP is unconfigured); per-recipient
  status is shown on the close console
- **Session inactivity expiry** — sessions expire after 30 minutes of
  inactivity

## Tech Stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com) + shadcn-style UI components
- [better-auth](https://better-auth.com) (email/password)
- [Drizzle ORM](https://orm.drizzle.team) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Playwright](https://playwright.dev) (smoke tests)

## Prerequisites

- Node.js 20+ (tested on 24)
- npm

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Create a .env file (required — `npm run seed` loads it via --env-file)
touch .env

# 3. Generate the seed dataset from the hackathon workbook
#    (data/ is gitignored, so this is required on a fresh clone —
#     it also creates the data/ directory the database lives in)
npm run dataset

# 4. Apply migrations (uses the committed migrations in drizzle/)
npm run db:migrate

# 5. Seed the database (partners, projects, task codes, fiscal periods, holidays)
npm run seed

# 6. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with a demo account below.

The SQLite database lives at `data/app.db` (gitignored). Delete it and re-run
`db:migrate` + `seed` for a fresh start.

## Demo Accounts

All seeded accounts share the password `hackathon2026`.

| Role             | Email                        |
| ---------------- | ---------------------------- |
| Admin            | aaron.alvarez@hackathon.com  |
| Manager          | fatima.kim@hackathon.com     |
| Employee         | ana.bell@hackathon.com       |
| Finance viewer   | finance.via@hackathon.com    |
| Leadership       | leland.lead@hackathon.com    |
| Project manager  | pm.pat@hackathon.com         |

## Roles

Capabilities are enforced server-side (`src/lib/permissions.ts`) — nav gating
is cosmetic only.

| Role              | Capabilities |
| ----------------- | ------------ |
| **Admin**         | Everything: week entry (incl. delegated entry for any partner), approvals, people & projects admin, period close, corrections, audit trail, all reports |
| **Manager**       | Week entry, approvals for direct reports, people & projects admin, all reports |
| **Employee**      | Own week entry, own reports/compliance view |
| **Finance viewer**| Read-only CapEx/Opex classification and actuals **totals** — no per-partner rows, no partner filter, no week entry, no admin surfaces |
| **Leadership**    | Read-only dashboards and reports (manager-level visibility, partner filters included) — no mutations anywhere |
| **Project manager**| Actuals and reports scoped to the projects they manage; can assign/unassign partners on **their** projects only — no people admin, approvals, or close |

The seeded project manager (Pat Calloway) manages the first two active seeded
projects, so the scoped PM view is demonstrable right after seeding.

## Scripts

| Command              | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `npm run dev`        | Start the dev server on port 3000                        |
| `npm run build`      | Production build                                         |
| `npm run start`      | Start the production server                              |
| `npm run lint`       | Run ESLint                                               |
| `npm run test`       | Run unit tests (node test runner)                        |
| `npm run seed`       | Seed the database from `data/hackathon-dataset.json` (run `dataset` first) |
| `npm run dataset`    | Regenerate the seed dataset from `IT Hackathon Workbook.xlsx` |
| `npm run smoke`      | Playwright smoke tests (requires seeded DB + dev server) |
| `npm run db:generate`| Generate Drizzle migrations from schema changes          |
| `npm run db:migrate` | Apply Drizzle migrations                                 |

## Environment Variables

Optional for local development; defaults are dev-only.

| Variable             | Purpose                          | Default                        |
| -------------------- | -------------------------------- | ------------------------------ |
| `BETTER_AUTH_SECRET` | Auth session signing secret      | Dev-only fallback (insecure)   |
| `SMTP_HOST` etc.     | Reminder/distribution email delivery (`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) | Unset → log-only mode |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key for the classification helper | Unset → helper hidden |
| `CRON_SECRET`        | Bearer secret for the `/api/reminders/run` cron entry point | Unset → admin session required |

See `.env.example` for details. Set a real `BETTER_AUTH_SECRET` for anything
beyond local development.

The dev server also accepts requests from LAN IPs (`http://192.168.x.x:3000`) —
useful when testing from another device on your network. Auth origins are
configured in `src/lib/auth.ts` (`allowedHosts`); add your production domain
there when deploying.

## Testing

```bash
# Unit tests (fiscal calendar, holidays, classification, entry validation,
# approval workflow, period close)
npm run test

# Smoke tests — run `npm run seed` and `npm run dev` first, then:
npm run smoke              # Phase 2: timesheet entry + submission scenarios
node scripts/phase4-smoke.cjs  # Phase 4: approval workflow + period close
node scripts/phase6-smoke.cjs  # Phase 6: settings + exception distribution
```

Smoke tests create and clean up their own test data (a smoke employee and project).

## Project Structure

```
src/
  app/
    (app)/            # Authenticated pages: dashboard, week, approvals, close,
                      # employees, projects, reports
    login/            # Sign-in page
    api/auth/         # better-auth route handlers
  components/         # Nav, theme provider, UI primitives (button, table, etc.)
  db/                 # Drizzle client, schema, seed script
  lib/                # Domain logic: fiscal, holidays, classification, reports,
                      # permissions, approval, close
scripts/              # Dataset generator + Playwright smoke tests
drizzle/              # Generated migrations
```
