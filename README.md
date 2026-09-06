# Time Tracker

A role-based weekly time-tracking application built for an IT hackathon. Employees log
hours against projects and non-project categories, managers/admins manage people and
assignments, and everyone can report on actuals, compliance, and capex/opex classification
across a 4-4-5 fiscal calendar.

## Features

- **Weekly timesheets** — grid entry per day with project/task-code or non-project
  categories, hands-on flags, and notes
- **Favorites** — pin project/task-code combos for quick entry in the week grid
- **Timesheet state machine** — `not_started → in_progress → submitted → in_correction → approved → locked`
- **Approval workflow** — managers/admins review submitted weeks in an approval queue;
  rejection sends the sheet back to the partner for correction. No self-approval —
  managers' own sheets and unmanaged partners route to admin. Every decision is kept
  in an insert-only audit trail
- **Capex/opex classification** — task-code rules resolve each entry's classification,
  with effective dates
- **Fiscal calendar** — FY26–FY27 4-4-5-style periods (12 periods/year) with holiday
  observance logic
- **Roles & permissions** — admin, manager, employee; managers/admins manage people and
  project assignments
- **Reports** — Time Spend, Period Actuals, Compliance, and CapEx/Opex tabs, each
  exportable as CSV or XLSX
- **Period close cycle** — admins initiate a fiscal-period close: exception report
  (unsubmitted weeks, hours outliers) → correction window (5 business days) → finalize
  (sheets lock) → reopen if needed

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

| Role    | Email                        |
| ------- | ---------------------------- |
| Admin   | aaron.alvarez@hackathon.com  |
| Manager | fatima.kim@hackathon.com     |
| Employee| ana.bell@hackathon.com        |

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

Set a real `BETTER_AUTH_SECRET` for anything beyond local development.

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
