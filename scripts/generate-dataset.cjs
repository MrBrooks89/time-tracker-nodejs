/**
 * Generates data/hackathon-dataset.json from the source workbook
 * (IT Hackathon Workbook.xlsx, repo root).
 *
 * Shape must match the `Dataset` interface in src/db/seed.ts exactly:
 *  - partners: { name, title, team, partnerCode, email, employment, status }
 *    (employment normalized to full_time|part_time|contractor; status to active|inactive)
 *  - projects: { name, number, status, notes, projectManager }
 *  - taskCodes: { name, description }
 *  - nonProjectCategories: { group, name, description }
 *  - classificationRules: { taskCode, classification: capex|opex, notes }
 *  - fiscalPeriods: mirrors FISCAL_PERIODS in src/lib/fiscal.ts (cross-checked)
 *  - expectedHolidays: 14 observed dates within FY26+FY27 (2025-10-01 .. 2027-12-24),
 *    computed with the same observance rules the seed validates against.
 *
 * Usage: node scripts/generate-dataset.cjs
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const WORKBOOK = path.join(process.cwd(), "IT Hackathon Workbook.xlsx");
const OUT = path.join(process.cwd(), "data", "hackathon-dataset.json");

const wb = XLSX.readFile(WORKBOOK);
const sheetRows = (name) =>
  XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });

// ---------- Partners ----------
// Directory Extract is the deduped canonical pivot view (the Partner Directory
// sheet lists 3 partners twice — same email + partner code under two rows —
// which would violate the user.email unique constraint). "Grand Total" is the
// pivot's footer row and is excluded.
// Columns: Full name | Role | Team | Partner ID | Email | Employment | Status
const partnerRows = sheetRows("Directory Extract")
  .slice(1)
  .filter((r) => r[0] && String(r[0]).trim() !== "Grand Total");
const partners = partnerRows.map((r) => {
  const [name, title, team, partnerCode, email, employmentRaw, statusRaw] = r;
  const employment =
    String(employmentRaw).toLowerCase() === "contractor"
      ? "contractor"
      : String(employmentRaw).toLowerCase() === "part_time"
        ? "part_time"
        : "full_time";
  return {
    name: String(name).trim(),
    title: String(title).trim(),
    team: String(team).trim(),
    partnerCode: String(partnerCode).trim(),
    email: String(email).trim().toLowerCase(),
    employment,
    status: String(statusRaw).toLowerCase() === "active" ? "active" : "inactive",
  };
});

// ---------- Projects ----------
// Project List: Project Name | Project Number | Status | Notes | Project Manager
const projectRows = sheetRows("Project List").slice(1).filter((r) => r[0]);
const projects = projectRows.map((r) => {
  const [name, number, statusRaw, notes, projectManager] = r;
  return {
    name: String(name).trim(),
    number: Number(number),
    status: String(statusRaw).toLowerCase() === "active" ? "active" : "inactive",
    notes: String(notes ?? "").trim(),
    projectManager: String(projectManager).trim(),
  };
});

// ---------- Task codes + non-project categories ----------
// Categories sheet: project task codes block, then non-project block.
const categoryRows = sheetRows("Categories");
const taskCodes = [];
const nonProjectCategories = [];
let mode = null;
for (const row of categoryRows) {
  const first = String(row[0] ?? "").trim();
  if (first === "Project Categories") { mode = "project"; continue; }
  if (first === "Non - Project Categories") { mode = "nonproject"; continue; }
  if (mode === "project" && row[1] && String(row[1]).trim() !== "Project Task Code") {
    taskCodes.push({
      name: String(row[1]).trim(),
      description: String(row[2] ?? "").trim(),
    });
  } else if (mode === "nonproject" && row[0] && first !== "Group") {
    nonProjectCategories.push({
      group: String(row[0]).trim(),
      name: String(row[1]).trim(),
      description: String(row[2] ?? "").trim(),
    });
  }
}

// ---------- Classification rules ----------
// CapEx - OpEx Classification: Project Task Code | Classification | Notes
const ruleRows = sheetRows("CapEx - OpEx Classification").slice(1).filter((r) => r[0]);
const classificationRules = ruleRows
  .filter((r) => r[1] && String(r[0]).trim() !== "Project Task Code")
  .map((r) => {
    const [taskCode, classificationRaw, notes] = r;
    const classification = /capex/i.test(String(classificationRaw))
      ? "capex"
      : "opex";
    return {
      taskCode: String(taskCode).trim(),
      classification,
      notes: String(notes ?? "").trim(),
    };
  });

// ---------- Fiscal periods (from workbook calendar, cross-checked vs fiscal.ts) ----------
const MS_PER_DAY = 86400000;
const excelSerialToDate = (serial) =>
  new Date(Date.UTC(1899, 11, 30) + Number(serial) * MS_PER_DAY);
const isoDate = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

const calendarRows = sheetRows("FY26 -FY27 Calendar").slice(3).filter((r) => r[0] || r[8]);
const fy26Periods = [];
const fy27Periods = [];
for (const row of calendarRows) {
  // FY26 block: cols 0-5 (quarter, period, start, end, wks, ...)
  if (row[0] && row[1] && row[2]) {
    fy26Periods.push({
      fiscalYear: 2026,
      quarter: Number(row[0]),
      periodNumber: Number(row[1]),
      startDate: isoDate(excelSerialToDate(row[2])),
      endDate: isoDate(excelSerialToDate(row[3])),
      weekCount: Number(row[4]),
    });
  }
  // FY27 block: cols 8-13
  if (row[8] && row[9] && row[10]) {
    fy27Periods.push({
      fiscalYear: 2027,
      quarter: Number(row[8]),
      periodNumber: Number(row[9]),
      startDate: isoDate(excelSerialToDate(row[10])),
      endDate: isoDate(excelSerialToDate(row[11])),
      weekCount: Number(row[12]),
    });
  }
}
const fiscalPeriods = [...fy26Periods, ...fy27Periods];

// Cross-check against FISCAL_PERIODS from src/lib/fiscal.ts
const fiscalTs = fs.readFileSync(
  path.join(process.cwd(), "src/lib/fiscal.ts"),
  "utf8",
);
const expectedPeriods = [...fiscalTs.matchAll(/\{ fiscalYear: (\d+), quarter: (\d+), periodNumber: (\d+), startDate: "([\d-]+)", endDate: "([\d-]+)", weekCount: (\d+) \}/g)]
  .map((m) => ({
    fiscalYear: Number(m[1]),
    quarter: Number(m[2]),
    periodNumber: Number(m[3]),
    startDate: m[4],
    endDate: m[5],
    weekCount: Number(m[6]),
  }));
if (fiscalPeriods.length !== expectedPeriods.length) {
  throw new Error(
    `Fiscal period count mismatch: workbook ${fiscalPeriods.length} vs fiscal.ts ${expectedPeriods.length}`,
  );
}
for (let i = 0; i < expectedPeriods.length; i++) {
  const a = fiscalPeriods[i];
  const b = expectedPeriods[i];
  for (const key of Object.keys(b)) {
    if (a[key] !== b[key]) {
      throw new Error(
        `Fiscal period mismatch at index ${i} key ${key}: workbook=${a[key]} fiscal.ts=${b[key]}`,
      );
    }
  }
}

// ---------- Expected holidays ----------
// Same observance rules as seed.ts; keep only dates within FY26+FY27
// (>= 2025-10-01), yielding the 14 validated entries (2025-11-27 .. 2027-12-24).
const observedFixed = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dow = date.getUTCDay();
  if (dow === 6) return isoDate(new Date(date.getTime() - MS_PER_DAY));
  if (dow === 0) return isoDate(new Date(date.getTime() + MS_PER_DAY));
  return isoDate(date);
};
const nthWeekday = (year, month, weekday, nth) => {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return isoDate(new Date(Date.UTC(year, month - 1, 1 + offset + (nth - 1) * 7)));
};
const lastWeekday = (year, month, weekday) => {
  const lastDay = new Date(Date.UTC(year, month, 0));
  const offset = (lastDay.getUTCDay() - weekday + 7) % 7;
  return isoDate(new Date(Date.UTC(year, month - 1, lastDay.getUTCDate() - offset)));
};
const computeHolidays = (year) => [
  { name: "New Year's Day", observedDate: observedFixed(year, 1, 1) },
  { name: "Memorial Day", observedDate: lastWeekday(year, 5, 1) },
  { name: "Independence Day", observedDate: observedFixed(year, 7, 4) },
  { name: "Labor Day", observedDate: nthWeekday(year, 9, 1, 1) },
  { name: "Thanksgiving", observedDate: nthWeekday(year, 11, 4, 4) },
  { name: "Christmas", observedDate: observedFixed(year, 12, 25) },
];

const expectedHolidays = {};
for (const year of [2025, 2026, 2027]) {
  for (const h of computeHolidays(year)) {
    if (h.observedDate >= "2025-10-01") {
      expectedHolidays[h.observedDate] = h.name;
    }
  }
}
if (Object.keys(expectedHolidays).length !== 14) {
  throw new Error(
    `Expected 14 holidays, got ${Object.keys(expectedHolidays).length}`,
  );
}

// ---------- Sanity checks ----------
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
assert(partners.length === 132, `partners: ${partners.length}`);
assert(partners.filter((p) => p.status === "active").length === 128, "active partners");
assert(partners.filter((p) => p.status === "inactive").length === 4, "inactive partners");
assert(projects.length === 22, `projects: ${projects.length}`);
assert(projects.filter((p) => p.status === "active").length === 18, "active projects");
assert(projects.filter((p) => p.status === "inactive").length === 4, "inactive projects");
assert(taskCodes.length === 11, `task codes: ${taskCodes.length}`);
assert(nonProjectCategories.length === 9, `categories: ${nonProjectCategories.length}`);
assert(classificationRules.length === 11, `rules: ${classificationRules.length}`);
assert(fiscalPeriods.length === 24, `fiscal periods: ${fiscalPeriods.length}`);

// Every project manager must exist in the partner directory
const partnerNames = new Set(partners.map((p) => p.name));
for (const project of projects) {
  assert(
    partnerNames.has(project.projectManager),
    `PM not found: ${project.projectManager}`,
  );
}
// Every task code must have a classification rule
const ruleTaskCodes = new Set(classificationRules.map((r) => r.taskCode));
for (const tc of taskCodes) {
  assert(ruleTaskCodes.has(tc.name), `Missing rule for task code: ${tc.name}`);
}
// Key users the seed special-cases
for (const email of [
  "aaron.alvarez@hackathon.com",
  "fatima.kim@hackathon.com",
  "christian.diaz@hackathon.com",
  "ana.bell@hackathon.com",
]) {
  assert(partners.some((p) => p.email === email), `Missing key user: ${email}`);
}
// Projects the seed special-cases by number
for (const n of [11, 13, 17, 24, 31]) {
  assert(projects.some((p) => p.number === n), `Missing project #${n}`);
}
// Categories the seed references by name
for (const name of ["Administrative", "Production Support", "Support - Meetings", "Business Enhancements"]) {
  assert(
    nonProjectCategories.some((c) => c.name === name),
    `Missing category: ${name}`,
  );
}

// ---------- Write ----------
const dataset = {
  partners,
  projects,
  taskCodes,
  nonProjectCategories,
  classificationRules,
  fiscalPeriods,
  expectedHolidays,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(dataset, null, 2) + "\n");

console.log("Dataset written to", OUT);
console.log(`  partners: ${partners.length} (${partners.filter((p) => p.status === "active").length} active)`);
console.log(`  contractors: ${partners.filter((p) => p.employment === "contractor").length}`);
console.log(`  projects: ${projects.length} (${projects.filter((p) => p.status === "active").length} active)`);
console.log(`  task codes: ${taskCodes.length}`);
console.log(`  non-project categories: ${nonProjectCategories.length}`);
console.log(`  classification rules: ${classificationRules.length}`);
console.log(`  fiscal periods: ${fiscalPeriods.length}`);
console.log(`  expected holidays: ${Object.keys(expectedHolidays).length}`);
