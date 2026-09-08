import { test } from "node:test";
import assert from "node:assert/strict";

import {
  JUDGMENT_THRESHOLD_DEFAULT,
  buildSuggestionPrompt,
  classificationSuggestionSchema,
  isJudgmentCall,
  resolveDeterministic,
  type NamedRuleInfo,
} from "./ai-classification.ts";

// The 11 seeded task codes with their fixed classifications
// (data/hackathon-dataset.json classificationRules).
const RULE_ROWS: NamedRuleInfo[] = [
  { taskCodeId: "tc-discovery", taskCodeName: "Discovery & Planning", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-requirements", taskCodeName: "Business Requirements", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-design", taskCodeName: "Design Solution", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-develop", taskCodeName: "Develop & Configure", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-testing", taskCodeName: "Testing", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-dc-develop", taskCodeName: "Data Conversion - Develop", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-dc-manual", taskCodeName: "Data Conversion - Manual", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-deploy", taskCodeName: "Deploy & Install", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-training", taskCodeName: "Training", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-support", taskCodeName: "Project Support", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
  { taskCodeId: "tc-oversight", taskCodeName: "Manager Oversight", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
];

const CAPEX_NAMES = [
  "Design Solution",
  "Develop & Configure",
  "Testing",
  "Data Conversion - Develop",
  "Deploy & Install",
];

const OPEX_NAMES = [
  "Discovery & Planning",
  "Business Requirements",
  "Data Conversion - Manual",
  "Training",
  "Project Support",
  "Manager Oversight",
];

test("isJudgmentCall: Manager Oversight is always a judgment call", () => {
  assert.equal(isJudgmentCall("Manager Oversight", null, 0), true);
  assert.equal(isJudgmentCall("Manager Oversight", null, 40), true);
  assert.equal(isJudgmentCall("Manager Oversight", "Administrative", 2), true);
});

test("isJudgmentCall: Business Enhancements crosses the threshold at 30", () => {
  assert.equal(
    isJudgmentCall(null, "Business Enhancements", 29.75),
    false,
    "29.75 below threshold",
  );
  assert.equal(
    isJudgmentCall(null, "Business Enhancements", 30),
    true,
    "30 at threshold (inclusive)",
  );
  assert.equal(
    isJudgmentCall(null, "Business Enhancements", 30.25),
    true,
    "30.25 above threshold",
  );
});

test("isJudgmentCall: custom threshold is honored", () => {
  assert.equal(isJudgmentCall(null, "Business Enhancements", 9.75, 10), false);
  assert.equal(isJudgmentCall(null, "Business Enhancements", 10, 10), true);
});

test("isJudgmentCall: other codes and categories are clear-cut", () => {
  assert.equal(isJudgmentCall("Develop & Configure", null, 40), false);
  assert.equal(isJudgmentCall(null, "Administrative", 40), false);
  assert.equal(isJudgmentCall(null, "Production Support", 100), false);
  assert.equal(isJudgmentCall(null, null, 40), false);
  assert.equal(isJudgmentCall("Manager Oversight", null, 0, 100), true);
  assert.equal(JUDGMENT_THRESHOLD_DEFAULT, 30);
});

test("resolveDeterministic echoes the rule classification for all 11 task codes", () => {
  for (const rule of RULE_ROWS) {
    assert.equal(
      resolveDeterministic(rule.taskCodeName, RULE_ROWS, "2026-06-01"),
      rule.classification,
      rule.taskCodeName,
    );
  }
  // Explicit split check: 5 capex, 6 opex (Manager Oversight defaults opex).
  for (const name of CAPEX_NAMES) {
    assert.equal(resolveDeterministic(name, RULE_ROWS, "2026-06-01"), "capex");
  }
  for (const name of OPEX_NAMES) {
    assert.equal(resolveDeterministic(name, RULE_ROWS, "2026-06-01"), "opex");
  }
});

test("resolveDeterministic: Manager Oversight defaults to opex even if a rule says capex", () => {
  // The hands-on exception is a human choice (TS-011) — never deterministic.
  const capexOversight: NamedRuleInfo[] = [
    { taskCodeId: "tc-oversight", taskCodeName: "Manager Oversight", classification: "capex", effectiveFrom: "2025-10-01", notes: null },
  ];
  assert.equal(
    resolveDeterministic("Manager Oversight", capexOversight, "2026-06-01"),
    "opex",
  );
});

test("resolveDeterministic derives from the rule rows, not a hardcoded table", () => {
  // Re-date Develop & Configure to opex mid-year; resolution must follow the
  // effective-dated rules exactly like classifyProjectEntry.
  const rules: NamedRuleInfo[] = [
    { taskCodeId: "tc-develop", taskCodeName: "Develop & Configure", classification: "opex", effectiveFrom: "2025-10-01", notes: null },
    { taskCodeId: "tc-develop", taskCodeName: "Develop & Configure", classification: "capex", effectiveFrom: "2026-06-01", notes: null },
  ];
  assert.equal(
    resolveDeterministic("Develop & Configure", rules, "2026-05-31"),
    "opex",
  );
  assert.equal(
    resolveDeterministic("Develop & Configure", rules, "2026-06-01"),
    "capex",
  );
  assert.equal(
    resolveDeterministic("Develop & Configure", rules, "2025-06-01"),
    null,
  );
});

test("resolveDeterministic: unknown task code yields null", () => {
  assert.equal(
    resolveDeterministic("Mystery", RULE_ROWS, "2026-06-01"),
    null,
  );
});

test("classificationSuggestionSchema: accepts a full suggestion with null judgmentCall", () => {
  const parsed = classificationSuggestionSchema.parse({
    classification: "opex",
    confidence: "high",
    explanation: "Post-go-live support is an operating expense.",
    judgmentCall: null,
  });
  assert.equal(parsed.classification, "opex");
  assert.equal(parsed.judgmentCall, null);
});

test("classificationSuggestionSchema: accepts a judgmentCall object", () => {
  const parsed = classificationSuggestionSchema.parse({
    classification: "opex",
    confidence: "medium",
    explanation: "High enhancement hours may warrant review.",
    judgmentCall: {
      kind: "capitalization_threshold",
      guidance: "Candidate for Finance/PMO elevation review.",
    },
  });
  assert.equal(parsed.judgmentCall?.kind, "capitalization_threshold");
});

test("classificationSuggestionSchema: judgmentCall is required (nullable, not optional)", () => {
  // strictJsonSchema (AI SDK default) rejects optional fields — a missing
  // judgmentCall key must fail so the model cannot omit it.
  const result = classificationSuggestionSchema.safeParse({
    classification: "opex",
    confidence: "low",
    explanation: "…",
  });
  assert.equal(result.success, false);
});

test("classificationSuggestionSchema: rejects invalid enum values", () => {
  assert.equal(
    classificationSuggestionSchema.safeParse({
      classification: "maybe",
      confidence: "high",
      explanation: "…",
      judgmentCall: null,
    }).success,
    false,
  );
  assert.equal(
    classificationSuggestionSchema.safeParse({
      classification: "capex",
      confidence: "certain",
      explanation: "…",
      judgmentCall: null,
    }).success,
    false,
  );
  assert.equal(
    classificationSuggestionSchema.safeParse({
      classification: "capex",
      confidence: "high",
      explanation: "…",
      judgmentCall: { kind: "other_kind", guidance: "…" },
    }).success,
    false,
  );
});

test("buildSuggestionPrompt: system embeds rule rows, criteria, and framing", () => {
  const { system } = buildSuggestionPrompt(
    { taskCodeName: "Manager Oversight", nonProjectCategoryName: null, weeklyHours: 10 },
    RULE_ROWS,
  );
  assert.ok(system.includes("Design Solution: CAPEX"));
  assert.ok(system.includes("Project Support: OPEX"));
  assert.ok(system.includes("effective 2025-10-01"));
  assert.ok(system.includes("hands-on deliverable contribution"));
  assert.ok(system.includes("Team management, coaching, and financial work are operating"));
  assert.ok(system.includes("capitalization threshold"));
  // Framing constraints (D2/D3 + TC-303 framing).
  assert.ok(system.includes("advisory only"));
  assert.ok(system.includes("Finance/PMO elevation review"));
  assert.ok(system.includes("Never suggest capex"));
});

test("buildSuggestionPrompt: system embeds the output JSON schema", () => {
  // Some OpenAI-compatible gateways route to models that ignore the
  // response_format payload; the schema must also live in the prompt.
  const { system } = buildSuggestionPrompt(
    { taskCodeName: null, nonProjectCategoryName: "Administrative", weeklyHours: 4 },
    RULE_ROWS,
  );
  assert.ok(system.includes("single JSON object"));
  assert.ok(system.includes("no markdown fences"));
  assert.ok(system.includes('"classification"'));
  assert.ok(system.includes('"judgmentCall"'));
});

test("buildSuggestionPrompt: Manager Oversight entry surfaces hands-on guidance", () => {
  const { prompt } = buildSuggestionPrompt(
    {
      taskCodeName: "Manager Oversight",
      nonProjectCategoryName: null,
      weeklyHours: 12,
      projectName: "ERP Rollout",
      projectNumber: 42,
      note: "Spent the week unblocking the team",
      weekStartDate: "2026-09-02",
    },
    RULE_ROWS,
  );
  assert.ok(prompt.includes('task code "Manager Oversight"'));
  assert.ok(prompt.includes("Weekly hours: 12"));
  assert.ok(prompt.includes("#42 ERP Rollout"));
  assert.ok(prompt.includes("Partner note: Spent the week unblocking the team"));
  assert.ok(prompt.includes("Week start: 2026-09-02"));
  assert.ok(prompt.includes("hands_on_exception"));
});

test("buildSuggestionPrompt: Business Enhancements entry is review guidance, never capex", () => {
  const { prompt } = buildSuggestionPrompt(
    {
      taskCodeName: null,
      nonProjectCategoryName: "Business Enhancements",
      weeklyHours: 32,
    },
    RULE_ROWS,
  );
  assert.ok(prompt.includes('non-project category "Business Enhancements"'));
  assert.ok(prompt.includes("Weekly hours: 32"));
  assert.ok(prompt.includes("capitalization_threshold"));
  assert.ok(prompt.includes("Finance/PMO elevation review"));
  assert.ok(prompt.includes('MUST be "opex"'));
});

test("buildSuggestionPrompt: clear-cut context asks for null judgmentCall", () => {
  const { prompt } = buildSuggestionPrompt(
    { taskCodeName: null, nonProjectCategoryName: "Administrative", weeklyHours: 4 },
    RULE_ROWS,
  );
  assert.ok(prompt.includes("Set judgmentCall to null."));
});
