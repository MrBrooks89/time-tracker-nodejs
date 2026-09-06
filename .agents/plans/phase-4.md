# Phase 4 — Manager Approval & Period Close

Scope locked with user: formal manager approval workflow (TS-030 future step, now built) + the real period-close cycle (TS-023–027) replacing the Phase 3 simulate-close shim. In-app indicators only (no email). Delegated entry, reminders, AI Helper, and locked-period restatement (TS-028/029) remain out of scope.

**Default scope decisions** (user didn't answer clarifying questions — flag on review):
- **D1 — Approval gates close**: a week can only be locked if its timesheet is `approved`. Unsubmitted sheets lock as `locked` (unchanged from shim behavior).
- **D2 — Self-approval**: managers cannot approve their own sheets; admin approves manager sheets. Managers are self-managed in seed, so admin is their approver.
- **D3 — No manager**: partners with no `managerId` are approved by admin.
- **D4 — Approval is optional until close**: approval does not block submission or editing; it only gates the lock step. Rejection sends the sheet back to the partner.
- **D5 — Close scope**: full close cycle in Phase 4 (exception report → correction window → finalize → unlock).

## Phase A — Schema + seed (sub-agent 1) — critical path

Fresh migration (`npm run db:generate` + `npm run db:migrate`, never push).

New/changed in `src/db/schema.ts`:
- `timesheet.state` enum extended: `not_started/in_progress/submitted/in_correction/approved/locked`
- `timesheet` + columns: `approvedAt` (timestamp_ms, nullable), `approvedBy` (text FK→user, nullable)
- `timesheetDecision` (insert-only audit): id, timesheetId FK, decision enum(approve/reject), decidedBy FK→user, note (text, nullable), decidedAt — one row per decision, full history preserved
- `periodClose`: id, fiscalYear int, periodNumber int, unique(fiscalYear, periodNumber), correctionWindowEndsAt (timestamp_ms, nullable), closedAt (timestamp_ms, nullable), closedBy FK→user nullable — one row per period; absence = open period
- `src/lib/config.ts`: `CORRECTION_WINDOW_DAYS = 5` (business days, TS-026 example), `HOURS_TOLERANCE = 0.8` (exception-report threshold: |actual − expected| / expected)

Seed updates (`src/db/seed.ts`):
- Historical submitted weeks (P7–P11): leave as `submitted` — approval history starts now; do NOT backfill decisions (clean demo state)
- Add 2–3 `in_correction` rows for demo (flagged weeks with a reject decision + note)
- Print decision/close counts in reconciliation output

## Phase B — Domain logic + unit tests (sub-agent 2, parallel with A, pure functions, no DB imports)

- `src/lib/approval.ts`: pure state-transition helpers — `canApprove(sheetState, viewerRole, viewerId, sheetUserId, sheetManagerId)`, `nextStateOnApprove`, `nextStateOnReject` (→ `in_correction`), `isApprovalComplete(state)` (approved|locked), `effectiveApprover(managerId)` (null → admin)
- `src/lib/close.ts`: pure close logic — `weeksOfPeriod(period)`, `exceptionFlags(sheets, entries, expectedHours, tolerance)` → unsubmitted / hours-outlier flags per sheet, `canFinalize(sheets)` (all submitted-or-better or explicitly waived), `correctionWindowEndsAt(closeInitiatedAt, holidays, days)` (business-day math reusing `src/lib/holidays.ts` rules)
- Tests in `src/lib/approval.test.ts`, `src/lib/close.test.ts` (node:test, strip-types): transition matrix incl. self-approval block (D2), null-manager → admin (D3), reject → in_correction, re-approve after correction, exception flagging with holiday-adjusted expected hours, business-day window math (window spanning a weekend + Labor Day)
- Constraints: no TS `enum` keyword, relative imports with `.ts` extension

## Phase C — Approval queue + week page integration (sub-agent 3, after A+B)

- Nav (`src/components/app-nav.tsx`): add "Approvals" item (manager+admin only) with icon; `manage` prop already gates Employees/Projects — extend pattern
- `/approvals` (manager+admin): queue of direct reports' `submitted` sheets (admin additionally sees sheets where approver = admin per D2/D3), columns: partner, team, week, hours, variance vs expected, submitted date, deadline; per-row "Review" link; badge count of pending
- `/approvals/review?userId=&week=`: read-only week view — reuse `getWeekData(userId, week)` (already userId-parameterized) rendered read-only (no grid inputs; summary rows + totals + variance + notes); Approve / Reject buttons (reject requires note) → server actions
- Server actions in `src/lib/actions/approvals.ts` (`"use server"`): `approveTimesheet(userId, weekStartDate)` / `rejectTimesheet(userId, weekStartDate, note)` — guards: session is manager/admin, target's `managerId === session.id` OR (admin AND target is manager-or-unmanaged per D2/D3), sheet state === `submitted`; approve → state `approved` + `approvedAt/approvedBy` + decision row; reject → `in_correction` + decision row; both `revalidatePath("/approvals")`, `/week`, `/`
- Week page (`/week`): state badge shows "Approved"/"In correction" with rejection note surfaced when `in_correction`; partner resubmits via existing Submit (already reverts to `submitted`); grid editability unchanged for `in_correction` (already editable — verify)
- Dashboard (`(app)/page.tsx`): manager/admin sees "Pending approvals" card with count + link; partner sees "Action needed" indicator when own sheet is `in_correction`
- `getWeekData`/`WeekData` type: add `approvedAt`, `approvedBy`, latest rejection note (from `timesheetDecision`) to the payload

## Phase D — Period close console (sub-agent 4, parallel with C, depends A+B)

- `/close` (admin only): period picker (open periods = no `periodClose` row with `closedAt`); per-period view: exception report table (unsubmitted, hours outliers vs holiday-adjusted expected, per TS-024), "Initiate close" → creates `periodClose` row + sets flagged sheets `in_correction` + opens correction window (D5); "Finalize" enabled when window elapsed OR all flagged sheets resubmitted-and-approved; finalize → all period sheets `locked` (submitted/approved/in_correction → locked; not_started stays not_started but period is closed)
- Replace `simulateClose`/`unlockWeek` shim: `week-admin-buttons.tsx` "Simulate close" → link to `/close` for admins; keep `unlockWeek` as admin "Reopen period" (deletes `periodClose` row, restores states from evidence: approvedAt → approved, submittedAt → submitted, else in_progress)
- Server actions `src/lib/actions/close.ts`: `initiateClose(fiscalYear, periodNumber)`, `finalizeClose(...)`, `reopenPeriod(...)` — admin-only guards; finalize validates approval gate (D1: every locked sheet must be approved-or-locked-eligible; unsubmitted sheets lock without approval per D1)
- Compliance report (`src/lib/reports.ts`): outstanding filter updated — `submitted` no longer counts as outstanding once approved exists? **No** — keep compliance = submission-focused (RP-002 unchanged); add "Approved" state display in compliance rows
- Reports: state badges updated for the new `approved` state where states are displayed

## Phase E — Verification (coordinator)

1. `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`
2. Reseed + dev server
3. Playwright scripted P1s:
   - Manager: /approvals queue lists direct reports' submitted weeks; review → approve → state "approved"; reject with note → partner sees "In correction" + note; partner edits + resubmits → manager re-approves
   - Self-approval blocked (manager's own submitted week not in own queue; admin queue contains it)
   - Admin: /close exception report lists unsubmitted + outlier; initiate → flagged sheets in_correction; finalize after window/resubmission → locked; locked sheet read-only in /week
   - State model order (TC-020): not_started → in_progress → submitted → approved → locked; reject path → in_correction → resubmit → approved
   - Regression: TC-001/003/005/007/008/009/010/012/014/016/017/021/022/024 + TC-201/202/203/205 still pass
4. Manual checklist: D1–D5 decisions behave as documented; demo script for approval + close flow

## Sequencing

A + B (disjoint: schema/seed vs pure libs) → C + D (C owns /approvals + week/dashboard; D owns /close + shim replacement) → E.
