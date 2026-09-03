# Phase 3 — Hackathon Build: Foundation + Reporting Dashboard

Scope locked with user: hackathon scope (Foundation mandatory + Reporting Dashboard stretch), full replacement of timestamp/clock-in model, full workbook synthetic seed, node:test + Playwright verification, shared partner password, weekly grid UI.

Demo day context: today = Sep 3 2026 = FY26 P12 W1 (Wed Sep 2). Current week contains Labor Day (Mon Sep 7) — holiday-adjusted expected hours demoable live.

## Phase A — Schema + seed + old-model cleanup (sub-agent 1) — critical path

Fresh migration (db:generate + db:migrate, never push). Old timeEntry data disposable.

New/changed tables (src/db/schema.ts):
- taskCode: id, name unique, description
- nonProjectCategory: id, group, name unique, description
- classificationRule: id, taskCodeId FK, classification enum(capex/opex), effectiveFrom (YYYY-MM-DD text), notes — one set effective 2025-10-01
- project (extend existing): + number int unique, + projectManagerId FK→user nullable, + costType enum(capital/operating/mixed); reuse isActive for status
- user (extend existing): + partnerCode text nullable (EMP####/TP####), + title, + team, + employmentType enum(full_time/part_time/contractor), + standardWeeklyHours real default 40, + managerId self-FK nullable
- projectAssignment: id, userId FK, projectId FK, assignedBy FK, assignedAt, removedAt — partial unique (userId, projectId) WHERE removedAt IS NULL
- assignmentChange: id, userId (target), projectId, changedBy, changeType enum(assigned/unassigned), changedAt — insert-only log
- fiscalPeriod: fiscalYear int, quarter int, periodNumber int, startDate, endDate, weekCount
- holiday: name, observedDate unique — seeded with known dates (2025-11-27 … 2027-12-24, 14 rows covering FY26+FY27)
- timesheet: id, userId FK, weekStartDate (YYYY-MM-DD text, Wednesday), state enum(not_started/in_progress/submitted/in_correction/locked), submittedAt nullable — unique(userId, weekStartDate). Period DERIVED from weekStartDate via fiscal lib (no FK)
- timeEntry: id, timesheetId FK, entryDate (YYYY-MM-DD text), hours real, projectId nullable, taskCodeId nullable, nonProjectCategoryId nullable, isHandsOn bool default false, resolvedClassification enum(capex/opex) NOT NULL, note nullable. Exactly one of taskCodeId/nonProjectCategoryId.
- favorite: userId, projectId, taskCodeId — unique triple
- src/lib/config.ts: maxHoursPerDay=16 etc. as constants (no config table)

Old-model cleanup (build stays green):
- DELETE src/app/(app)/timesheet/, src/components/live-timer.tsx, src/lib/time-entries.ts, src/lib/actions/time-entries.ts, src/lib/reports.ts, src/app/(app)/reports/export/
- REWRITE placeholders: (app)/page.tsx (welcome, no timer), (app)/reports/page.tsx (placeholder card), CREATE (app)/week/page.tsx placeholder (Phase C replaces)
- EDIT app-nav.tsx: Timesheet → My Week /week

Seed (src/db/seed.ts, reads data/hackathon-dataset.json):
- 131 active + 4 inactive partners, shared password "hackathon2026" (single hash, direct user+account inserts per people.ts pattern — NOT signUpEmail)
- App roles: admin = aaron.alvarez (EMP0051), managers = fatima.kim (EMP0014) + christian.diaz (EMP0004), rest employee
- managerId synthesis: per team, member with Manager/Supervisor/Lead in title → manager; else alphabetically first; managers self-managed
- Contractors → standardWeeklyHours 24 (≠40, TC-027)
- 22 projects (18 active, 4 inactive) + synthetic costType = [capital,operating,mixed][number % 3]
- 11 task codes, 9 categories, classification rules (effective 2025-10-01, notes from workbook)
- FY26+FY27 fiscal periods (24 rows)
- Assignments: each active partner 2-4 active projects (deterministic RNG), inactive partners get history-compatible assignments
- Historical entries P7–P11 (Apr 8 – Sep 1 2026, crosses Q3/Q4) + a few current-week in_progress rows; entries on weekdays, 0.25 increments, mostly ~40h weeks; include Manager Oversight (few handsOn=true), Business Enhancements, low-hour outlier weeks; inactive partners/projects included (TC-002/028 history)
- Timesheet states: submitted rows with submittedAt for seeded weeks; a few in_progress; missing row = not_started (compliance LEFT JOIN)
- Prints reconciliation counts

## Phase B — Domain libs + unit tests (sub-agent 2, parallel with A, pure functions only — no DB imports)

- src/lib/fiscal.ts: weekStart(date) Wednesday; findWeek(date)→{weekStartDate, weekIndex}; findPeriod(date)→period row data; weeksInPeriod; weekEnterable = weekStartDate <= currentWeekStartDate (past + current open; satisfies TC-029)
- src/lib/holidays.ts: observance rules (fixed-date: weekday→that day, Sat→prior Fri, Sun→next Mon; Memorial=last Mon May, Labor=first Mon Sep, Thanksgiving=4th Thu Nov); observedHolidays(year); deadlineForWeek(weekStart) = Monday after week end, shifted to prior Friday if Monday observed holiday; expectedHours(weekStart, stdHours, holidays[]) = stdHours − (stdHours/5)×holidays-in-week
- src/lib/classification.ts: pure classify(taskCodeId, rules[], entryDate, isHandsOn) — latest rule with effectiveFrom <= entryDate; Manager Oversight + handsOn → capex; non-project → opex
- package.json test script: node --test --experimental-strip-types
- Tests in src/lib/*.test.ts: holidays 2025-2027 (incl. Jul 4 2026 Sat→Jul 3, Dec 25 2027 Sat→Dec 24), deadline shift (week ending Sep 1 2026 → deadline Fri Sep 4, Labor Day), fiscal week/period mapping (Sep 3 2026 → FY26 P12 W1; week ending Jan 6 2026 → P3), effective-dated rules, 0.25 validation helper
- Constraints: no TS `enum` keyword (strip-types), relative imports with .ts extension

## Phase C — My Week + admin surfaces (sub-agent 3, after A+B)

- Nav: Dashboard, My Week /week, Reports, Employees+Projects (admin/manager)
- /week: week picker (prev/next, only enterable weeks), weekly grid (rows: assigned projects + task-code select w/ classification note helper text; non-project category rows; columns Wed–Tue with holiday chips), 0.25h cells, row+weekly totals, variance badge vs expectedHours (warning only, met/not-met/exceeded), Manager Oversight reveals hands-on toggle + guidance text, optional note per row, deadline shown, Save draft (in_progress), Submit (blocked if zero hours → submitted+submittedAt), edit submitted → reverts to in_progress, locked → read-only
- copyPriorWeek: re-validate target open, skip unassigned/inactive projects, re-resolve classification at new dates
- favorites: quick-add (validates assignment), unique triple
- Server validations: exactly-one-code, assignment membership, isActive, 0.25 multiples (Number.isInteger(h*4)), ≥0, per-day ≤16, week enterable, re-resolve classification on save
- Admin: "simulate period close" action → sets week timesheets locked (TC-020 shim)
- Dashboard: own-week status card + admin compliance snapshot (unsubmitted due weeks, deadline-aware)
- Employees page: + team/title/employment/stdHours columns, assignment multi-select edit (writes assignmentChange log); ADD entry-count guard to deleteEmployee (P1 fix); Projects page: + number/PM/costType
- Delete/cleanup any remaining old references

## Phase D — Reporting Dashboard stretch (sub-agent 4, parallel with C, depends A+B only)

- src/lib/reports.ts: queries by fiscal week/period/quarter/year + team/manager/project/category; role scoping (employee = own data); prior-period via (fiscalYear, periodNumber) handling FY27P1→FY26P12; compliance = roster LEFT JOIN timesheet (missing = not_started)
- Pages: Period Actuals Summary (partner/project/category totals + capex/opex + prior-period Δ), Timesheet Compliance (by week/period), CapEx/OpEx Classification (project/task-code/aggregate), IT Time Spend Dashboard (project vs non-project hours + %, trailing periods trend, drill by team/manager; SVG chart in blueprint-surface, chart-1..5 tokens)
- Exports: 4 routes ?format=csv|xlsx (npm i xlsx); Content-Disposition attachment
- Filters per RP-006

## Phase E — Verification (coordinator)

1. lint + tsc --noEmit + build + test
2. reseed + dev server
3. Playwright scripted P1s: TC-001/003/005/007/008/009/010/012/014/016/017/020/021/022/024/030 + TC-201/202/203/205
4. Manual checklist for P2s + demo script (4 judge questions)

## Sequencing

A + B (disjoint) → C + D (C owns nav/dashboard/reports-link, D owns reports dir) → E.
