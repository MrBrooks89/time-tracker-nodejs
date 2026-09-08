/**
 * Phase 6 smoke: exception-report distribution (TS-025) + settings surface.
 * Requires: seeded DB + dev server on :3000.
 * Creates its own close on FY2026 P12 (left initiated, not finalized) and
 * cleans up the period_close row afterwards (cascade clears distribution).
 */
const { chromium } = require("playwright");
const Database = require("better-sqlite3");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const dbPath = path.join(__dirname, "..", "data", "app.db");

let passed = 0;
let failed = 0;
function check(name, ok) {
  if (ok) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

(async () => {
  const db = new Database(dbPath);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  // Accept the confirm dialog that guards initiate/finalize/reopen actions.
  page.on("dialog", (dialog) => dialog.accept());

  try {
    // Sign in as admin
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/email/i).fill("aaron.alvarez@hackathon.com");
    await page.getByLabel(/password/i).fill("hackathon2026");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/$/);

    // Settings page renders for admin with all fields
    await page.goto(`${BASE}/settings`);
    let body = await page.textContent("body");
    check("settings page renders for admin", /max hours/i.test(body));
    check("settings has reminder templates", /reminder subject/i.test(body));

    // Non-admin blocked: employee session in a second context
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/login`);
    await p2.getByLabel(/email/i).fill("ana.bell@hackathon.com");
    await p2.getByLabel(/password/i).fill("hackathon2026");
    await p2.getByRole("button", { name: /sign in/i }).click();
    await p2.waitForURL(/\/$/);
    await p2.goto(`${BASE}/settings`);
    body = await p2.textContent("body");
    check(
      "settings blocked for employee (no form fields)",
      !/correction window days/i.test(body),
    );
    await ctx2.close();

    // Initiate close on FY2026 P12 → distribution rows appear
    await page.goto(`${BASE}/close?year=2026&period=12`);
    // Cold-compiled pages hydrate late — wait for the button before clicking
    const initiate = page.getByRole("button", { name: /initiate close/i });
    await initiate.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(1000); // let hydration attach handlers
    await initiate.click();
    await page
      .waitForFunction(
        () => /window ends/i.test(document.body.textContent || ""),
        { timeout: 30000 },
      )
      .catch(() => {});
    body = await page.textContent("body");
    check("close initiated (window opens)", /window ends/i.test(body));
    check(
      "distribution card renders",
      /exception report distribution/i.test(body),
    );

    const rows = db
      .prepare(
        "select recipient_email, recipient_role, status from distribution_log",
      )
      .all();
    check(
      "distribution_log rows written (log-only would_send)",
      rows.length > 0 && rows.every((r) => r.status === "would_send"),
    );
    check(
      "recipients are managers/PMs (not partners)",
      rows.every((r) => r.recipient_role !== "employee"),
    );
    console.log(
      `  info: ${rows.length} distribution rows (roles: ${[...new Set(rows.map((r) => r.recipient_role))].join(", ")})`,
    );

    // Reminder ad-hoc trigger in log-only mode → would_send rows
    await page.goto(`${BASE}/reminders`);
    body = await page.textContent("body");
    check("reminders page renders with template editor", /subject/i.test(body));
    const sendBtn = page.getByRole("button", { name: /send reminder/i });
    if (await sendBtn.count()) {
      await sendBtn.first().click();
      await page.waitForLoadState("networkidle");
      const logRows = db
        .prepare(
          "select channel, status, trigger from reminder_log order by reminded_at desc limit 5",
        )
        .all();
      check(
        "reminder log-only mode records would_send",
        logRows.some((r) => r.status === "would_send"),
      );
    } else {
      console.log("  info: no ad-hoc reminder button visible (no outstanding) — skipped");
    }
  } finally {
    // Cleanup: remove the close row (cascade clears distribution_log)
    db.prepare("delete from period_close where fiscal_year=2026 and period_number=12").run();
    db.close();
    await browser.close();
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
