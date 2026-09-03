Research complete. Here's the finalized Phase 1 execution plan — in plan mode I can't implement yet, so review and approve:
Phase 1: Foundation — Detailed Plan
Step 0 — Dependencies
npm i drizzle-orm better-sqlite3 better-auth next-themes lucide-react clsx tailwind-merge
npm i -D drizzle-kit @types/better-sqlite3
(Latest versions verified: drizzle-orm 0.45.2, better-auth 1.7.2, drizzle-kit 13.x)
Step 1 — Design system (sub-agent A)
- src/app/globals.css: full token set from DESIGN.md (oklch colors, @theme inline bridge incl. --font-display, --font-body, --font-code, chart-1..5) + utilities: .planner-bg, .glass-panel, .paper-card, .blueprint-surface, .command-strip, .micro-label
- src/app/layout.tsx: swap Geist → IBM_Plex_Sans, Fraunces, IBM_Plex_Mono via next/font/google; next-themes ThemeProvider, class-based, dark default
- src/lib/utils.ts: cn() (clsx + tailwind-merge)
- src/components/ui/: shadcn-style button.tsx, card.tsx, input.tsx, label.tsx, badge.tsx, select.tsx following DESIGN.md interaction rules (focus rings, hover lift, pill buttons)
Step 2 — Database + Auth (sub-agent B, parallel with A)
- drizzle.config.ts (SQLite, src/db/schema.ts, migrations to ./drizzle)
- src/db/schema.ts: better-auth tables (user with role: admin|manager|employee enum, session, account, verification) + timeEntries (id, userId FK, startTime, endTime, note, createdAt, updatedAt) — generated via @better-auth/cli generate then extended
- Run drizzle-kit generate + drizzle-kit migrate (never push, per AGENTS.md)
- src/lib/auth.ts: better-auth instance, Drizzle adapter, credentials plugin, role on session
- src/lib/auth-client.ts: client hooks
- src/app/api/auth/[...all]/route.ts: handler
- src/proxy.ts: Next.js 16 proxy (not middleware) — redirect unauthenticated → /login
- src/db/seed.ts: one admin user for smoke testing (expanded in Phase 3)
Step 3 — Login page + shell (after A + B)
- src/app/login/page.tsx: design-system styled login (glass panel, micro-label eyebrow)
- src/app/(dashboard)/page.tsx + loading.tsx + error.tsx: minimal authenticated shell showing session user + role badge — proves the full auth flow end-to-end
Step 4 — Verification (I run these)
- npx drizzle-kit generate && npx drizzle-kit migrate
- npm run lint, tsc --noEmit, npm run build
- npm run dev smoke test: login as seeded admin, verify session/role/protection
Delegation: A + B run in parallel (disjoint files), then Step 3, then verification. No test framework yet — that's Phase 3 per plan.
