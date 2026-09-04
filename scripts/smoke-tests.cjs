/**
 * Phase 2 Step 6 smoke tests — Playwright run against a dev server on :3000.
 *
 * Prerequisites:
 *   npm run seed   (fresh dataset; shared password "hackathon2026")
 *   npm run dev    (in another shell)
 *
 * Usage: npm run smoke
 *
 * Creates "Smoke Test Employee" + "Smoke Test Project", verifies the Phase 2
 * acceptance scenarios, then cleans up its own test data (user deletion
 * cascades to sessions/accounts/timesheets/entries).
 */
const { chromium } = require("playwright");
const Database = require("better-sqlite3");
const path = require("path");

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "hackathon2026";
const SMOKE_EMAIL = "smoke.employee@hackathon.com";
const SMOKE_PASSWORD = "smoke12345";
const SMOKE_PROJECT = "Smoke Test Project";

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

/** Remove test data from a previous run (user delete cascades the rest). */
function cleanupSmokeData() {
  const db = new Database(path.join(process.cwd(), "data", "app.db"));
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM user WHERE email = ?").run(SMOKE_EMAIL);
  db.prepare("DELETE FROM project WHERE name = ?").run(SMOKE_PROJECT);
  db.close();
}

async function signInFresh(browser, email, password = PASSWORD) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  // Either we navigate to / or an error message appears
  await Promise.race([
    page.waitForURL(`${BASE}/`, { timeout: 15000 }),
    page.waitForSelector("text=Invalid email or password", { timeout: 15000 }),
  ]);
  if (!page.url().endsWith("/")) {
    throw new Error(`Sign-in failed for ${email} — still at ${page.url()}`);
  }
  return { context, page };
}

(async () => {
  cleanupSmokeData();

  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  // ---- 1. Unauthenticated redirect ----------------------------------------
  console.log("\n[1] Unauthenticated access");
  const anonCtx = await browser.newContext();
  const anonPage = await anonCtx.newPage();
  await anonPage.goto(`${BASE}/`);
  await anonPage.waitForURL(/\/login/);
  check("GET / redirects to /login when signed out", anonPage.url().endsWith("/login"));
  await anonCtx.close();

  // ---- 2. Admin: nav links + create project + employee ---------------------
  console.log("\n[2] Admin");
  let ctx = await signInFresh(browser, "aaron.alvarez@hackathon.com");
  let page = ctx.page;
  const navLinks = await page.locator("nav a").allTextContents();
  check("admin sees Dashboard", navLinks.some((t) => /Dashboard/.test(t)));
  check("admin sees My Week", navLinks.some((t) => /My Week/.test(t)));
  check("admin sees Reports", navLinks.some((t) => /Reports/.test(t)));
  check("admin sees Employees", navLinks.some((t) => /Employees/.test(t)));
  check("admin sees Projects", navLinks.some((t) => /Projects/.test(t)));

  // Create project
  await page.goto(`${BASE}/projects`);
  await page.getByRole("button", { name: /add project/i }).click();
  await page.fill('input[name="name"]', SMOKE_PROJECT);
  await page.fill('textarea[name="description"]', "Created by smoke test");
  await page.click('button[type=submit]:has-text("Add project")');
  await page.waitForSelector(`text=${SMOKE_PROJECT}`);
  check("admin creates project", true);

  // Create employee
  await page.goto(`${BASE}/employees`);
  await page.getByRole("button", { name: /add employee/i }).click();
  await page.fill('input[name="name"]', "Smoke Test Employee");
  await page.fill('input[name="email"]', SMOKE_EMAIL);
  await page.fill('input[name="password"]', SMOKE_PASSWORD);
  await page.click('button[type=submit]:has-text("Add employee")');
  await page.waitForSelector("text=Smoke Test Employee");
  check("admin creates employee", true);
  await ctx.context.close();

  // ---- 3. New employee: nav scoping + week + reports + CSV -----------------
  console.log("\n[3] Employee scoping");
  ctx = await signInFresh(browser, SMOKE_EMAIL, SMOKE_PASSWORD);
  page = ctx.page;
  const empLinks = await page.locator("nav a").allTextContents();
  check("employee does NOT see Employees link", !empLinks.some((t) => /Employees/.test(t)));
  check("employee does NOT see Projects link", !empLinks.some((t) => /Projects/.test(t)));

  // /employees redirects home
  await page.goto(`${BASE}/employees`);
  await page.waitForURL(`${BASE}/`);
  check("/employees redirects employee home", page.url() === `${BASE}/`);

  // /projects redirects home
  await page.goto(`${BASE}/projects`);
  await page.waitForURL(`${BASE}/`);
  check("/projects redirects employee home", page.url() === `${BASE}/`);

  // Reports scoped to own data (new employee has no entries)
  await page.goto(`${BASE}/reports?tab=actuals`);
  const body = await page.textContent("body");
  check("employee reports page loads", body.includes("Period Actuals"));
  check("employee sees own (empty) scope", !body.includes("Aaron Alvarez"));

  // CSV export works and is attachment
  const downloadPromise = page.waitForEvent("download");
  try {
    await page.goto(
      `${BASE}/reports/export?tab=actuals&format=csv&year=2026&period=11`,
      { waitUntil: "commit" },
    );
  } catch {
    // "Download is starting" — expected for attachment responses
  }
  const download = await downloadPromise;
  check("CSV download triggers", Boolean(download));
  check(
    "CSV filename has attachment name",
    /time-report-actuals/.test(download.suggestedFilename()),
  );
  await ctx.context.close();

  // ---- 4. Manager: all entries + filters + people pages --------------------
  console.log("\n[4] Manager");
  ctx = await signInFresh(browser, "fatima.kim@hackathon.com");
  page = ctx.page;
  const mgrLinks = await page.locator("nav a").allTextContents();
  check("manager sees Employees link", mgrLinks.some((t) => /Employees/.test(t)));
  check("manager sees Projects link", mgrLinks.some((t) => /Projects/.test(t)));

  await page.goto(`${BASE}/reports?tab=actuals&year=2026&period=11`);
  const mgrBody = await page.textContent("body");
  check("manager reports show other partners' data", mgrBody.includes("Aaron Alvarez"));

  // Filters present for manager
  const teamFilter = await page.locator("select").count();
  check("manager has report filters", teamFilter > 0);

  await page.goto(`${BASE}/employees`);
  check("manager can open /employees", (await page.textContent("body")).includes("Employees"));
  await page.goto(`${BASE}/projects`);
  check("manager can open /projects", (await page.textContent("body")).includes("Projects"));
  await ctx.context.close();

  // ---- 5. Deactivated user: fresh sign-in blocked ---------------------------
  console.log("\n[5] Deactivated user");
  const deactCtx = await browser.newContext();
  const deactPage = await deactCtx.newPage();
  await deactPage.goto(`${BASE}/login`);
  await deactPage.waitForLoadState("networkidle");
  await deactPage.fill("#email", "andre.bishop@hackathon.com");
  await deactPage.fill("#password", PASSWORD);
  await deactPage.click("button[type=submit]");
  await deactPage.waitForTimeout(2500);
  const stillOnLogin = deactPage.url().includes("/login");
  const errShown = await deactPage.locator("text=Invalid email or password").count();
  check("deactivated user cannot sign in", stillOnLogin && errShown > 0);
  await deactCtx.close();

  // ---- 6. Week page: add row + save draft ----------------------------------
  console.log("\n[6] Week page flow");
  ctx = await signInFresh(browser, SMOKE_EMAIL, SMOKE_PASSWORD);
  page = ctx.page;
  await page.goto(`${BASE}/week`);
  const weekBody = await page.textContent("body");
  check("week page renders", weekBody.includes("My Week"));

  // Add a non-project category row (always available), fill 8h on first day
  const addCatBtn = page.getByRole("button", { name: /category row/i });
  if (await addCatBtn.count()) {
    await addCatBtn.click();
    const firstCell = page.locator('input[type="number"]').first();
    await firstCell.waitFor({ state: "visible", timeout: 5000 });
    await firstCell.fill("8");
    const saveBtn = page.getByRole("button", { name: /save draft/i });
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
      const afterSave = await page.textContent("body");
      check(
        "save draft transitions to in_progress",
        afterSave.includes("In progress"),
      );
    } else {
      check("save draft button exists", false, "no save button");
    }
  } else {
    check("category row button exists", false, "button not found");
  }
  await ctx.context.close();
  await browser.close();

  cleanupSmokeData();

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error("SMOKE TEST CRASH:", err);
  process.exit(1);
});
