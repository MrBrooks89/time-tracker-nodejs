/**
 * Phase 4 smoke tests — manager approval + period close, Playwright against a
 * dev server on :3000.
 *
 * Prerequisites:
 *   npm run seed   (fresh dataset; shared password "hackathon2026")
 *   npm run dev    (in another shell)
 *
 * Usage: node scripts/phase4-smoke.cjs
 *
 * Covers the Phase 4 acceptance scenarios:
 *   1. Role gating: employee blocked from /approvals + /close; nav scoping
 *   2. Manager queue: Fatima sees her reports' submitted weeks; self-approval
 *      block (her own sheets are NOT in her queue — they route to admin, D2)
 *   3. Approve flow: review → approve → state "approved"
 *   4. Reject flow: review → return for correction with note → partner sees
 *      "In correction" + manager note; resubmit → manager re-approves
 *   5. Admin queue: Aaron sees self-managed managers' sheets (D2/D3)
 *   6. Close flow: exception report → initiate (outliers → in_correction) →
 *      finalize blocked by D1 gate → window forced elapsed via DB → finalize
 *      locks period → locked sheet read-only → reopen restores states
 */
const { chromium } = require("playwright");
const Database = require("better-sqlite3");
const path = require("path");

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "hackathon2026";
const DB_FILE = path.join(process.cwd(), "data", "app.db");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

function db() {
  return new Database(DB_FILE);
}

/** Pick a direct report of the given manager email with a submitted sheet. */
function pickReportSheet(managerEmail) {
  const d = db();
  const row = d
    .prepare(
      `SELECT u.id as userId, u.name, t.week_start_date as week
       FROM timesheet t JOIN user u ON u.id = t.user_id
       JOIN user m ON m.id = u.manager_id
       WHERE m.email = ? AND t.state = 'submitted'
       ORDER BY t.week_start_date DESC LIMIT 1`,
    )
    .get(managerEmail);
  d.close();
  return row;
}

/** Pick one of the manager's OWN submitted sheets (self-approval test). */
function pickOwnSheet(email) {
  const d = db();
  const row = d
    .prepare(
      `SELECT week_start_date as week FROM timesheet
       WHERE user_id = (SELECT id FROM user WHERE email = ?)
         AND state = 'submitted' ORDER BY week_start_date DESC LIMIT 1`,
    )
    .get(email);
  d.close();
  return row;
}

async function signInFresh(browser, email, password = PASSWORD) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await Promise.race([
    page.waitForURL(`${BASE}/`, { timeout: 15000 }),
    page.waitForSelector("text=Invalid email or password", { timeout: 15000 }),
  ]);
  if (!page.url().endsWith("/")) {
    throw new Error(`Sign-in failed for ${email} — still at ${page.url()}`);
  }
  return { context, page };
}

/** Accept the confirm dialog that guards approve/finalize/reopen actions. */
function autoConfirm(page) {
  page.on("dialog", (dialog) => dialog.accept());
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  // ---- 1. Role gating -------------------------------------------------------
  console.log("\n[1] Role gating");
  let ctx = await signInFresh(browser, "aisha.banerjee@hackathon.com");
  let page = ctx.page;
  const empLinks = await page.locator("nav a").allTextContents();
  check("employee does NOT see Approvals link", !empLinks.some((t) => /Approvals/.test(t)));
  await page.goto(`${BASE}/approvals`);
  await page.waitForURL(`${BASE}/`);
  check("/approvals redirects employee home", page.url() === `${BASE}/`);
  await page.goto(`${BASE}/close`);
  await page.waitForURL(`${BASE}/`);
  check("/close redirects employee home", page.url() === `${BASE}/`);
  await ctx.context.close();

  // ---- 2. Manager queue + self-approval block -------------------------------
  console.log("\n[2] Manager queue (Fatima)");
  ctx = await signInFresh(browser, "fatima.kim@hackathon.com");
  page = ctx.page;
  autoConfirm(page);
  const mgrLinks = await page.locator("nav a").allTextContents();
  check("manager sees Approvals link", mgrLinks.some((t) => /Approvals/.test(t)));

  const report = pickReportSheet("fatima.kim@hackathon.com");
  check("seed has a submitted sheet for Fatima's report", Boolean(report));
  const own = pickOwnSheet("fatima.kim@hackathon.com");
  check("seed has Fatima's own submitted sheet", Boolean(own));

  await page.goto(`${BASE}/approvals`);
  let body = await page.textContent("body");
  const queueTable = await page.locator("table").textContent();
  check("queue lists the report's partner", queueTable.includes(report.name));
  check(
    "self-approval block: Fatima's own sheet NOT in her queue",
    !queueTable.includes("Fatima Kim"),
  );
  check("queue shows pending count", /pending/.test(body));

  // ---- 3. Approve flow ------------------------------------------------------
  console.log("\n[3] Approve flow");
  await page.goto(
    `${BASE}/approvals/review?userId=${encodeURIComponent(report.userId)}&week=${encodeURIComponent(report.week)}`,
  );
  body = await page.textContent("body");
  check("review page shows partner name", body.includes(report.name));
  check("review page shows read-only grid", body.includes("Approval Review"));

  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForURL(`${BASE}/approvals`, { timeout: 15000 });
  await page.waitForTimeout(1500);

  const d3 = db();
  const approved = d3
    .prepare(
      "SELECT state FROM timesheet WHERE user_id = ? AND week_start_date = ?",
    )
    .get(report.userId, report.week);
  d3.close();
  check("sheet state is approved after approve", approved?.state === "approved");

  // ---- 4. Reject flow + partner resubmit + re-approve -----------------------
  console.log("\n[4] Reject → correct → resubmit → re-approve");
  const report2 = pickReportSheet("fatima.kim@hackathon.com");
  check("another submitted sheet available for reject test", Boolean(report2));

  await page.goto(
    `${BASE}/approvals/review?userId=${encodeURIComponent(report2.userId)}&week=${encodeURIComponent(report2.week)}`,
  );
  await page.getByRole("button", { name: /return for correction/i }).first().click();
  await page.fill("#rejection-note", "Smoke test: please verify Thursday hours.");
  await page.getByRole("button", { name: /return for correction/i }).last().click();
  await page.waitForURL(`${BASE}/approvals`, { timeout: 15000 });
  await page.waitForTimeout(1500);

  const d4 = db();
  const rejected = d4
    .prepare(
      "SELECT state FROM timesheet WHERE user_id = ? AND week_start_date = ?",
    )
    .get(report2.userId, report2.week);
  d4.close();
  check(
    "sheet state is in_correction after reject",
    rejected?.state === "in_correction",
  );

  // Partner sees the note on their week page
  const partnerEmail = db()
    .prepare("SELECT email FROM user WHERE id = ?")
    .get(report2.userId)?.email;
  await ctx.context.close();

  ctx = await signInFresh(browser, partnerEmail);
  page = ctx.page;
  autoConfirm(page);
  await page.goto(`${BASE}/week?week=${report2.week}`);
  body = await page.textContent("body");
  check("partner sees In correction badge", body.includes("In correction"));
  check(
    "partner sees manager rejection note",
    body.includes("Smoke test: please verify Thursday hours."),
  );

  // Partner resubmits (submit button on an in_correction sheet with hours)
  const submitBtn = page.getByRole("button", { name: /submit week/i });
  if (await submitBtn.count()) {
    await submitBtn.first().click();
    await page
      .waitForSelector("text=/Submitted/i", { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(2000);
    const d4b = db();
    const resub = d4b
      .prepare(
        "SELECT state FROM timesheet WHERE user_id = ? AND week_start_date = ?",
      )
      .get(report2.userId, report2.week);
    d4b.close();
    check("sheet back to submitted after resubmit", resub?.state === "submitted");
  } else {
    check("submit button available for resubmit", false, "no submit button");
  }
  await ctx.context.close();

  // Manager re-approves
  ctx = await signInFresh(browser, "fatima.kim@hackathon.com");
  page = ctx.page;
  autoConfirm(page);
  await page.goto(
    `${BASE}/approvals/review?userId=${encodeURIComponent(report2.userId)}&week=${encodeURIComponent(report2.week)}`,
  );
  const approveBtn = page.getByRole("button", { name: "Approve" });
  if (await approveBtn.count()) {
    await approveBtn.click();
    await page.waitForURL(`${BASE}/approvals`, { timeout: 15000 });
    await page.waitForTimeout(1500);
    const d4c = db();
    const reapproved = d4c
      .prepare(
        "SELECT state FROM timesheet WHERE user_id = ? AND week_start_date = ?",
      )
      .get(report2.userId, report2.week);
    d4c.close();
    check("sheet approved after re-approval", reapproved?.state === "approved");
  } else {
    check("approve button available after resubmit", false);
  }
  await ctx.context.close();

  // ---- 5. Admin queue (D2/D3) ----------------------------------------------
  console.log("\n[5] Admin queue (Aaron)");
  ctx = await signInFresh(browser, "aaron.alvarez@hackathon.com");
  page = ctx.page;
  autoConfirm(page);
  await page.goto(`${BASE}/approvals`);
  body = await page.textContent("body");
  check("admin queue includes Fatima (self-managed → admin)", body.includes("Fatima Kim"));
  check("admin queue includes Christian (self-managed → admin)", body.includes("Christian Diaz"));
  await ctx.context.close();

  // ---- 6. Close flow --------------------------------------------------------
  console.log("\n[6] Period close (FY26 P11)");
  ctx = await signInFresh(browser, "aaron.alvarez@hackathon.com");
  page = ctx.page;
  autoConfirm(page);

  await page.goto(`${BASE}/close?year=2026&period=11`);
  body = await page.textContent("body");
  check("close console renders exception report", body.includes("Exception"));

  await page.getByRole("button", { name: /initiate close/i }).click();
  await page
    .waitForSelector("text=/Window ends/i", { timeout: 20000 })
    .catch(() => {});
  body = await page.textContent("body");
  check("correction window opens after initiate", /window ends/i.test(body));

  const d6 = db();
  const outliers = d6
    .prepare(
      `SELECT COUNT(*) as n FROM timesheet t
       JOIN period_close pc ON pc.fiscal_year = 2026 AND pc.period_number = 11
       WHERE t.state = 'in_correction'`,
    )
    .get();
  d6.close();
  check("outlier sheets moved to in_correction", outliers.n > 0, `count=${outliers.n}`);

  // D1 gate: finalize blocked while submitted/in_correction sheets remain
  const finalizeBtn = page.getByRole("button", { name: /finalize period/i });
  check(
    "finalize button rendered",
    (await finalizeBtn.count()) > 0 || (await finalizeBtn.isVisible().catch(() => false)),
  );
  check(
    "finalize disabled while gate unmet (D1)",
    await finalizeBtn.isDisabled(),
  );

  // Force the correction window elapsed via DB (5 business days is not waitable)
  const d6b = db();
  d6b
    .prepare(
      "UPDATE period_close SET correction_window_ends_at = unixepoch() * 1000 - 86400000 WHERE fiscal_year = 2026 AND period_number = 11",
    )
    .run();
  d6b.close();
  await page.reload();
  await page.waitForTimeout(1500);

  await page.getByRole("button", { name: /finalize period/i }).click();
  await page
    .waitForSelector("text=/^Closed$/m", { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  body = await page.textContent("body");
  check("period shows closed after finalize", /closed/i.test(body));

  const d6c = db();
  const lockedCount = d6c
    .prepare(
      `SELECT COUNT(*) as n FROM timesheet t JOIN fiscal_period fp
       ON t.week_start_date >= fp.start_date AND t.week_start_date <= fp.end_date
       WHERE fp.fiscal_year = 2026 AND fp.period_number = 11 AND t.state = 'locked'`,
    )
    .get();
  const remaining = d6c
    .prepare(
      `SELECT COUNT(*) as n FROM timesheet t JOIN fiscal_period fp
       ON t.week_start_date >= fp.start_date AND t.week_start_date <= fp.end_date
       WHERE fp.fiscal_year = 2026 AND fp.period_number = 11
         AND t.state NOT IN ('locked','not_started')`,
    )
    .get();
  d6c.close();
  check("period sheets locked after finalize", lockedCount.n > 0, `locked=${lockedCount.n}`);
  check(
    "no unlocked sheet rows remain in period",
    remaining.n === 0,
    `remaining=${remaining.n}`,
  );

  // Locked sheet is read-only on /week
  const lockedSheet = db()
    .prepare(
      `SELECT t.user_id, u.email, t.week_start_date as week FROM timesheet t
       JOIN user u ON u.id = t.user_id JOIN fiscal_period fp
       ON t.week_start_date >= fp.start_date AND t.week_start_date <= fp.end_date
       WHERE fp.fiscal_year = 2026 AND fp.period_number = 11 AND t.state = 'locked' LIMIT 1`,
    )
    .get();
  await page.goto(`${BASE}/week?week=${lockedSheet.week}`);
  const weekBody = await page.textContent("body");
  check("locked week shows Locked badge", weekBody.includes("Locked"));
  const saveBtn = page.getByRole("button", { name: /save draft/i });
  const saveCount = await saveBtn.count();
  check(
    "locked week is read-only (save absent or disabled)",
    saveCount === 0 || (await saveBtn.isDisabled()),
  );

  // Reopen restores states
  await page.goto(`${BASE}/close?year=2026&period=11`);
  await page.getByRole("button", { name: /reopen period/i }).click();
  await page.waitForTimeout(2500);
  const d6d = db();
  const restored = d6d
    .prepare(
      `SELECT COUNT(*) as n FROM timesheet t JOIN fiscal_period fp
       ON t.week_start_date >= fp.start_date AND t.week_start_date <= fp.end_date
       WHERE fp.fiscal_year = 2026 AND fp.period_number = 11 AND t.state = 'locked'`,
    )
    .get();
  const pc = d6d
    .prepare("SELECT id FROM period_close WHERE fiscal_year = 2026 AND period_number = 11")
    .get();
  d6d.close();
  check("reopen removes period_close row", !pc);
  check("reopen restores locked sheets", restored.n === 0, `locked remaining=${restored.n}`);
  await ctx.context.close();

  await browser.close();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error("PHASE4 SMOKE CRASH:", err);
  process.exit(1);
});
