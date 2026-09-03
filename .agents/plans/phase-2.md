# Phase 2 — Employee Management, Time Entries, Reports

Foundation: Phase 1 (better-auth with roles admin/manager/employee, Drizzle/SQLite, design system, login + dashboard shell). Scope decisions approved by user:

- Employee management: admin + manager
- Time capture: live clock in/out timer + manual entries
- Approvals workflow: deferred to Phase 3
- Projects: new project table, per-entry project assignment
- Reports: summary tables + SVG chart + CSV export

## Step 1 — Schema + seed (sub-agent A)

- `project` table: `id` (text pk), `name` (text, unique), `description` (nullable), `isActive` (bool, default 1), `createdAt`/`updatedAt` (timestamp_ms, unixepoch defaults) — mirrors existing style in `src/db/schema.ts`
- `timeEntry` gains nullable `projectId` FK → project (`ON DELETE SET NULL`) + index, plus partial unique index `ON (user_id) WHERE end_time IS NULL` → enforces one active timer per user
- Run `npm run db:generate` + `npm run db:migrate` (never `drizzle push`)
- Seed expansion: 3 projects + ~20 completed entries across the 3 seeded users over the last 7 days (incl. today), business hours, no overlaps per user, NO active entries (timer starts clean). Order: delete users (cascades entries) → recreate users → upsert projects → insert entries (fresh ids looked up by email/name)

## Step 2 — Auth & permissions (sub-agent B, parallel with A)

- Block sign-in for deactivated users via `databaseHooks.session.create.before` returning `false` (verified approach; `validateUserInfo` does NOT apply to email/password sign-ins)
- `src/lib/permissions.ts`: `requireRole(roles)`, `canManagePeople(role)` (admin|manager), `requirePeopleManager()`
- Deactivation flow (Step 4) also deletes the target's `session` rows; cookieCache staleness window ≤ 5 min is documented and accepted

## Step 3 — App shell + dashboard (sub-agent C, after A+B)

- New `src/app/(app)/` route group: `layout.tsx` with role-aware sidebar (Dashboard /, Timesheet /timesheet, Reports /reports for all; Employees /employees + Projects /projects for admin+manager) using the existing `--sidebar*` tokens; mobile collapses to top nav. Layout renders sidebar + content only — root layout owns `<html>/<body>`
- Move `src/app/page.tsx` → `(app)/page.tsx` (delete the original to avoid route conflict); add scoped `(app)/loading.tsx`; root `error.tsx`/`loading.tsx` stay untouched
- `src/lib/time-entries.ts`: `getActiveEntry(userId)`, `getRecentEntries(userId, limit)` (with project name), `listEntries(filters)`, `validateEntry` (end > start, no overlap with user's entries)
- `src/lib/actions/time-entries.ts` (`"use server"`): `clockIn` / `clockOut` with one-active-entry enforcement, `revalidatePath("/")`
- Dashboard: live timer widget (client interval ticking elapsed HH:MM:SS, clock in/out buttons), today's logged hours, recent 5 entries with project badges; replaces Phase 2 placeholders

## Step 4 — Pages + server actions (D / E / F in parallel)

- **D — Timesheet** `(app)/timesheet/`: entries list — own entries for employees, all entries + employee/project/date filters for managers/admins; manual entry form (`datetime-local` start/end parsed as server-local, project select, note); edit/delete own entries (managers/admins edit any); validation end > start + no overlap. Extends `src/lib/time-entries.ts` + `src/lib/actions/time-entries.ts` (createEntry/updateEntry/deleteEntry)
- **E — Employees + Projects** `(app)/employees/`, `(app)/projects/` (admin+manager): employee create does a direct drizzle insert of BOTH `user` and `account` rows — account: `accountId = userId`, `providerId = "credential"`, `issuer = "local:credential"`, `password = await hashPassword(...)` from `better-auth/crypto` (named export `hashPassword`; enforce min length 8 since better-auth validation is bypassed; do NOT use `signUpEmail` — `autoSignIn` mints a session). Guards: cannot deactivate or change own role; deactivation deletes the user's session rows. Projects CRUD: delete blocked when entries reference (offer deactivate instead)
- **F — Reports** `(app)/reports/`: date-range + employee/project filters (employees scoped to own data only), per-employee + per-project summary tables, hand-rolled SVG daily-hours bar chart in `.blueprint-surface` using `fill-chart-1..5` classes (no chart library), accessible text alternative. CSV export via `(app)/reports/export/route.ts` (inside the route group; session + role scoping in the handler; `Content-Disposition: attachment`). Shared queries in `src/lib/reports.ts`; single timezone strategy — local date-parts grouping + local CSV timestamps

## Step 5 — Design compliance (all agents)

`planner-bg` main, `glass-panel`/`paper-card` cards, `micro-label` eyebrows, `font-display` titles, `animate-fade-up`/`animate-scale-in`, visible focus rings, hover lift, existing badge variants only.

## Step 6 — Verification (coordinator)

1. `npm run lint`, `npx tsc --noEmit`, `npm run build`
2. `npm run seed`, `npm run dev`
3. Playwright MCP smoke tests:
   - unauthenticated `/` redirects to `/login`; admin: all sidebar links, create project + employee
   - new employee: no Employees/Projects links; clock in → running timer → clock out; add manual entry; timesheet list
   - manager: sees all entries with filters; /employees + /projects access
   - employee: /employees redirects home; reports scoped to own data; CSV download works
   - deactivated user: fresh sign-in blocked (note ≤ 5-min cookie window for already-active sessions)

## Parallelization

A + B (disjoint files) → C → D + E + F (disjoint directories) → verification.
