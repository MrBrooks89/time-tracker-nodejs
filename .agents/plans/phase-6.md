# Phase 6 — AI Classification Helper + High-Value Core Gaps

Scope locked with user: the AI CapEx/OpEx classification helper (stretch goal #3, test cases TC-301–305) plus four high-value core-spec gaps — email reminders (TS-019/020), admin-configurable tolerances (NF-012), exception-report distribution (TS-025), and session inactivity expiry (NF-005). Deferred: mobile-responsive grid, migration import, taxonomy admin UI, WCAG audit, LDAP sync.

**Default scope decisions** (locked via clarifying questions):
- **D1 — AI provider**: Vercel AI Gateway (`AI_GATEWAY_API_KEY`, model via `provider/model` string). AI SDK v7 (`ai` + `@ai-sdk/react` + `zod`); no provider package needed.
- **D2 — AI is advisory only** (TC-304): suggestions are never stored as classification. Stored classification always comes from the deterministic effective-dated rules (CX-004) or an explicit human decision (hands-on checkbox / PMO review). The helper renders advice + explanation only.
- **D3 — Deterministic first** (TC-301): clear-cut task codes never hit the model — the helper echoes the fixed rule. Only judgment calls invoke the LLM: Manager Oversight (TC-302, surfaces hands-on-exception criteria) and Business Enhancements with high hours (TC-303, surfaces capitalization-threshold review).
- **D4 — Graceful degradation** (TC-305): low model confidence or no API key → helper states low confidence / hides itself and defers to the default rule; the app is fully functional without AI.
- **D5 — Email**: nodemailer + env-configured SMTP (`SMTP_HOST/PORT/USER/PASS/FROM`). Unconfigured SMTP → log-only mode (reminder/distribution rows recorded as `would_send`), in-app surfaces unchanged. Reminder content (subject/body templates) admin-editable.
- **D6 — Distribution channel**: at close initiation, the exception report is emailed to the managers of flagged partners and PMs of affected projects; every send logged. Log-only when SMTP unconfigured.
- **D7 — Settings storage**: new `appSetting` key/value table; `src/lib/config.ts` constants become the defaults. Admin UI at `/settings` (admin only). Deadline-day auto-reminder runs lazily (first authenticated request of the day) + an idempotent `/api/reminders/run` route for external cron.

## Phase A — Schema + seed (sub-agent 1) — critical path

Fresh migration (`npm run db:generate` + `npm run db:migrate`, never push).

New/changed in `src/db/schema.ts`:
- `appSetting`: key (text PK), value (text), updatedBy FK→user nullable, updatedAt (timestamp_ms) — typed keys enumerated in `src/lib/settings.ts`
- `reminderLog` extended: `channel` enum(`in_app`, `email`), `status` enum(`sent`, `would_send`, `failed`), `recipient` (text, nullable), `trigger` enum(`manual`, `scheduled`) — `remindedBy` made nullable (auto/scheduled sends have no acting admin; manual sends keep the acting user); existing rows keep working via defaults. `trigger` + `weekStartDate` + `recipient` form the idempotency marker for scheduled sends (one scheduled send per recipient per deadline day)
- `distributionLog` (insert-only): id, closeId FK→periodClose, recipientEmail, recipientRole, sentAt, status — one row per exception-report recipient

Seed updates (`src/db/seed.ts`):
- Default settings rows: `max_hours_per_day=16`, `correction_window_days=5`, `hours_tolerance=0.8`, `reminder_subject`, `reminder_body` (sensible defaults matching current in-app copy)
- Print settings + log counts in reconciliation output

## Phase B — Pure domain logic + unit tests (sub-agent 2, parallel with A, no DB imports)

- `src/lib/settings.ts`: setting key constants + types, parse/validate functions (positive ints, tolerance range 0–1, template placeholders `{partner}`, `{week}`, `{due_date}`, `{hours}`), `defaultSettings` export; DB read layer kept thin and separate so parse/validate stays pure
- `src/lib/ai-classification.ts`: pure suggestion pipeline — `isJudgmentCall(taskCode, category, hours)` (Manager Oversight task code always; Business Enhancements **non-project category** when weekly hours ≥ configurable threshold, default 30), `buildSuggestionPrompt(entryContext, rules)` (system prompt embeds the effective-dated rule rows + hands-on criteria + capitalization-threshold guidance), zod schema `classificationSuggestion = { classification: "capex"|"opex", confidence: "high"|"medium"|"low", explanation: string, judgmentCall: null | { kind: "hands_on_exception"|"capitalization_threshold", guidance: string } }`, `resolveDeterministic(taskCode, rules)` — derived from the same effective-dated `classificationRule` rows the app already resolves with (`classifyProjectEntry`), never a hardcoded echo table (divergence hazard). Framing constraint: Business Enhancements is hard-ruled OpEx in the app — the TC-303 suggestion is advisory *review guidance* ("candidate for Finance/PMO elevation review"), never a CapEx classification hint
- `src/lib/email.ts`: pure template rendering (`renderReminderEmail(template, data)`), SMTP env parsing (`smtpConfigFromEnv()` → null when unconfigured), exception-report email body builder from the close exception data
- Tests in `src/lib/settings.test.ts`, `src/lib/ai-classification.test.ts`, `src/lib/email.test.ts` (node:test, strip-types): validation bounds, judgment-call routing incl. threshold boundary, deterministic echo for all 11 task codes, template placeholder substitution, SMTP null fallback
- Constraints: no TS `enum` keyword, relative imports with `.ts` extension

## Phase C — AI helper endpoint + week-grid integration (sub-agent 3, after A+B)

- `npm install ai @ai-sdk/react zod` (verify installed versions against bundled docs before coding — never write AI SDK code from memory)
- Route handler `src/app/api/ai/classification/route.ts` (POST): auth guard — valid session **and** explicit `isActive` check (`requireUser` does not check `isActive`; deactivated users with live sessions must be rejected); body = entry context (task code, category, hours, project, note, week); deterministic-first per D3 → judgment calls run `streamText` with `Output.object({ schema })` via AI Gateway model string (setting `ai_model`, default from current gateway model list — fetch at implementation time, never from memory; treat AI SDK v7 API names as unconfirmed until verified against bundled docs); `export const maxDuration = 30`; no `AI_GATEWAY_API_KEY` → `{ available: false }` (D4)
- Week grid (`src/app/(app)/week/week-grid.tsx`): when a judgment-call code is selected, an advisory panel appears — `useObject` streaming consumption; shows suggestion + confidence + explanation + judgment-call guidance; "Apply hands-on exception" checkbox pre-recommendation for Manager Oversight (writes only the existing TS-011 flag on explicit user action); "Flag for PMO/Finance review" note suggestion for Business Enhancements; dismissible; never renders as authoritative (D2) — labeled "AI suggestion — advisory only"
- UI follows DESIGN.md tokens; panel hidden entirely when helper unavailable (D4)

## Phase D — Email reminders + exception distribution (sub-agent 4, parallel with C, after A+B)

- `npm install nodemailer` (check bundled types; add `@types/nodemailer` only if needed)
- `src/lib/mailer.ts`: transport from `smtpConfigFromEnv()`; `sendMail` wrapper that in log-only mode writes `reminderLog`/`distributionLog` rows with `status: "would_send"` (D5)
- Reminders (`src/lib/reminders.ts`, `src/lib/actions/reminders.ts`, `/reminders` page): subject/body templates read from settings (Phase A) with placeholder substitution; admin template editor on the reminders page; ad-hoc trigger now sends email when configured; `maybeRunScheduledReminders()` — idempotent via the `trigger="scheduled"` marker (one scheduled send per recipient per deadline day, deadline from existing `deadlineForWeek` incl. holiday shift TS-015; `isDeadlineDay()` already exists), wrapped in a transaction + try/catch so a failure can never break page render, invoked lazily on the **first navigation** of the day (app layout runs on RSC navigations only — not server actions/API routes) + exposed at `src/app/api/reminders/run/route.ts` (auth: admin or cron secret) for external scheduling
- Exception distribution: `initiateClose` (`src/lib/actions/close.ts`) collects flagged sheets → recipients = managers of flagged partners + PMs of affected projects (dedup). **Recipient definition**: use the export-style exception set (all active partners with `unsubmitted` or `hours_outlier` flags — superset of `initiateClose`'s hours_outlier-only set) so distribution matches what the report shows. Prereq: extract `loadExceptionRows` from `src/app/(app)/close/export/route.ts` (route files can't be imported) into `src/lib/close.ts` or a shared lib, reused by both the export route and distribution. Email the exception report → `distributionLog` rows; close page shows distribution status per close
- Reminder history page: channel + status + trigger columns added
- Add `.env.example` documenting the new SMTP vars (`SMTP_HOST/PORT/USER/PASS/FROM`) and `AI_GATEWAY_API_KEY`

## Phase E — Settings admin UI + session expiry (sub-agent 5, after A)

- `/settings` (admin only, nav item): form for `max_hours_per_day`, `correction_window_days`, `hours_tolerance`, `ai_model`, reminder templates; server actions in `src/lib/actions/settings.ts` with validation from Phase B; audit-log each change; `revalidatePath` on affected surfaces
- Replace `config.ts` constant reads with the settings reader (DB value → fallback default); `config.ts` remains the defaults module; touch points: entry validation (`src/lib/actions/week.ts`), close window math + exception flagging (`src/lib/actions/close.ts`), **close page display (`src/app/(app)/close/page.tsx`) and close export (`src/app/(app)/close/export/route.ts`)** — all four must read the same setting or the displayed/exported report diverges from what close enforces
- Session inactivity (NF-005): better-auth `session.expiresIn` (~30 min) **and `updateAge` tuned down (e.g., 60–300s)** — better-auth's default `updateAge` is ~24h, so with `expiresIn=1800` alone, active users would be dropped mid-session because the expiry only extends on activity after `updateAge` elapses; verify exact semantics against better-auth docs (ExternalScout during implementation — do not trust memory); confirm interplay with `cookieCache.maxAge` (currently 5 min) so expired sessions are not served from cache

## Phase F — Verification (coordinator)

1. `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`
2. Reseed + dev server
3. Playwright/manual P1s:
   - AI helper: clear-cut code → deterministic echo, no model call (TC-301); Manager Oversight → advisory panel + hands-on prompt, checkbox still user-driven (TC-302); Business Enhancements ≥ threshold → elevation-review prompt (TC-303); saved classification unchanged by AI in all cases (TC-304); no API key → panel hidden, entry flow unaffected (TC-305/D4)
   - Email: SMTP unconfigured → log-only `would_send` rows, UI unchanged; configured (or mocked) → reminder + distribution emails recorded with recipients; deadline-day lazy trigger idempotent (no duplicate sends)
   - Settings: admin edits tolerance → exception report + entry validation reflect new value without code change; non-admin blocked from `/settings`
   - Session: idle past expiry → next request requires re-login
   - Regression: TC-001–019, TC-201–205, approval + close flows still pass
4. Manual checklist: D1–D7 behave as documented; demo script for AI helper + email flow

## Sequencing

A + B (disjoint) → C + D + E (C,D need A+B; E needs A; C/D/E touch disjoint surfaces) → F.
