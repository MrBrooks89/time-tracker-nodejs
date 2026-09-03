import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyEntry,
  classifyNonProjectEntry,
  classifyProjectEntry,
  type RuleInfo,
} from "./classification.ts";

const baseRules: RuleInfo[] = [
  { taskCodeId: "tc-design", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-develop", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-testing", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-dc-develop", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-deploy", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-discovery", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-requirements", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-dc-manual", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-training", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-support", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-oversight", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
];

test("TC-021: capital task codes classify as capex", () => {
  for (const id of ["tc-design", "tc-develop", "tc-testing", "tc-dc-develop", "tc-deploy"]) {
    assert.equal(classifyProjectEntry(id, baseRules, "2026-06-01"), "capex", id);
  }
});

test("TC-022: operating task codes classify as opex", () => {
  for (const id of ["tc-discovery", "tc-requirements", "tc-dc-manual", "tc-training", "tc-support"]) {
    assert.equal(classifyProjectEntry(id, baseRules, "2026-06-01"), "opex", id);
  }
});

test("effective-dated rules: latest effectiveFrom on or before entry wins", () => {
  const rules: RuleInfo[] = [
    { taskCodeId: "tc-develop", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
    { taskCodeId: "tc-develop", classification: "capex", effectiveFrom: "2026-06-01", notes: null },
  ];
  assert.equal(classifyProjectEntry("tc-develop", rules, "2026-05-31"), "opex");
  assert.equal(classifyProjectEntry("tc-develop", rules, "2026-06-01"), "capex");
  assert.equal(classifyProjectEntry("tc-develop", rules, "2025-06-01"), null);
});

test("TC-016/TC-017: Manager Oversight hands-on exception", () => {
  assert.equal(
    classifyEntry("tc-oversight", "Manager Oversight", baseRules, "2026-06-01", false),
    "opex",
  );
  assert.equal(
    classifyEntry("tc-oversight", "Manager Oversight", baseRules, "2026-06-01", true),
    "capex",
  );
  assert.equal(
    classifyEntry("tc-develop", "Develop & Configure", baseRules, "2026-06-01", true),
    "capex",
  );
});

test("unknown task code yields null; non-project is always opex", () => {
  assert.equal(classifyProjectEntry("tc-missing", baseRules, "2026-06-01"), null);
  assert.equal(classifyNonProjectEntry(), "opex");
});
