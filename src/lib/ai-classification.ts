// Phase 6 (D2/D3): advisory AI classification helper — pure domain logic.
// The AI is advisory only (D2): suggestions are never stored as
// classification. Deterministic rules win (D3): clear-cut task codes never
// reach the model — resolution derives from the same effective-dated
// classification rule rows the app already resolves with
// (classifyProjectEntry), never a hardcoded echo table.

import { z } from "zod";

import {
  classifyProjectEntry,
  type Classification,
  type RuleInfo,
} from "./classification.ts";

/** Weekly-hours threshold above which Business Enhancements becomes a
 * judgment call (TC-303). Configurable; 30 is the locked default. */
export const JUDGMENT_THRESHOLD_DEFAULT = 30;

export const MANAGER_OVERSIGHT_CODE = "Manager Oversight";
export const BUSINESS_ENHANCEMENTS_CATEGORY = "Business Enhancements";

// Zod v4 + AI SDK structured output: strictJsonSchema defaults to true, so
// optional() fields break JSON-schema conversion — every nullable field uses
// .nullable(), never .optional().

export const judgmentCallSchema = z.object({
  kind: z.enum(["hands_on_exception", "capitalization_threshold"]),
  guidance: z.string(),
});

export const classificationSuggestionSchema = z.object({
  classification: z.enum(["capex", "opex"]),
  confidence: z.enum(["high", "medium", "low"]),
  explanation: z.string(),
  judgmentCall: judgmentCallSchema.nullable(),
});

export type JudgmentCall = z.infer<typeof judgmentCallSchema>;
export type ClassificationSuggestion = z.infer<
  typeof classificationSuggestionSchema
>;

/** True when the entry needs human/AI judgment instead of a fixed rule:
 * Manager Oversight always (the hands-on exception is a human choice,
 * TC-302); Business Enhancements — a non-project category — once weekly
 * hours reach the threshold (TC-303). Everything else is clear-cut. */
export function isJudgmentCall(
  taskCodeName: string | null,
  nonProjectCategoryName: string | null,
  weeklyHours: number,
  threshold: number = JUDGMENT_THRESHOLD_DEFAULT,
): boolean {
  if (taskCodeName === MANAGER_OVERSIGHT_CODE) return true;
  if (
    nonProjectCategoryName === BUSINESS_ENHANCEMENTS_CATEGORY &&
    weeklyHours >= threshold
  ) {
    return true;
  }
  return false;
}

/** A classification rule row joined with its task code name — the shape the
 * AI helper consumes. Extends RuleInfo, so the same DB rows feed both the
 * deterministic resolver (which delegates to classifyProjectEntry) and the
 * prompt builder. */
export interface NamedRuleInfo extends RuleInfo {
  taskCodeName: string;
}

/** Deterministic resolution for clear-cut codes (TC-301). Delegates to
 * classifyProjectEntry over the full rule set so effective-dating can never
 * diverge from the app's stored-classification path (task_code.name is
 * unique, so the name lookup is unambiguous). Manager Oversight always
 * resolves to the rule default ("opex") here — its capex path is the human
 * hands-on exception (TS-011), never a deterministic outcome. Unknown codes
 * → null. */
export function resolveDeterministic(
  taskCodeName: string,
  rules: NamedRuleInfo[],
  entryDate: string,
): Classification | null {
  const taskCodeId = rules.find(
    (rule) => rule.taskCodeName === taskCodeName,
  )?.taskCodeId;
  if (taskCodeId === undefined) return null;
  const resolved = classifyProjectEntry(taskCodeId, rules, entryDate);
  if (resolved === null) return null;
  if (taskCodeName === MANAGER_OVERSIGHT_CODE) return "opex";
  return resolved;
}

export interface EntryContext {
  taskCodeName: string | null;
  nonProjectCategoryName: string | null;
  weeklyHours: number;
  projectName?: string | null;
  projectNumber?: number | null;
  note?: string | null;
  weekStartDate?: string | null;
}

const HANDS_ON_CRITERIA =
  "Hands-on means a hands-on deliverable contribution to a capital phase. " +
  "Team management, coaching, and financial work are operating.";

const CAPITALIZATION_THRESHOLD_GUIDANCE =
  "Work below the capitalization threshold for a formal project stays " +
  "operating. Elevated or recurring enhancement effort may warrant a " +
  "Finance/PMO elevation review — that review is advisory and human-owned.";

function renderRuleRows(rules: NamedRuleInfo[]): string {
  return rules
    .map(
      (rule) =>
        `- ${rule.taskCodeName}: ${rule.classification.toUpperCase()} ` +
        `(effective ${rule.effectiveFrom})` +
        (rule.notes ? ` — ${rule.notes}` : ""),
    )
    .join("\n");
}

/** Builds the { system, prompt } pair for the advisory suggestion call.
 * The system prompt embeds the effective-dated rule rows, the hands-on
 * criteria, and the capitalization-threshold guidance. Framing constraint:
 * Business Enhancements is hard-ruled OpEx in the app — the suggestion for
 * it is advisory review guidance only, never a CapEx classification hint. */
export function buildSuggestionPrompt(
  entry: EntryContext,
  rules: NamedRuleInfo[],
): { system: string; prompt: string } {
  const subject = entry.taskCodeName
    ? `task code "${entry.taskCodeName}" (project entry)`
    : `non-project category "${entry.nonProjectCategoryName ?? "unknown"}"`;

  const judgmentGuidance = entry.taskCodeName === MANAGER_OVERSIGHT_CODE
    ? "Set judgmentCall to kind \"hands_on_exception\" and surface the " +
      "hands-on criteria in guidance; the human decides via the checkbox."
    : entry.nonProjectCategoryName === BUSINESS_ENHANCEMENTS_CATEGORY
      ? "classification MUST be \"opex\". Set judgmentCall to kind " +
        "\"capitalization_threshold\" with guidance framing the entry as a " +
        "candidate for Finance/PMO elevation review. Never suggest capex " +
        "for Business Enhancements."
      : "Set judgmentCall to null.";

  const system = [
    "You advise on CapEx/OpEx classification of timesheet entries. " +
      "Suggestions are advisory only — they are never stored as " +
      "classification; deterministic rules and human decisions always win.",
    "Effective-dated classification rules:",
    renderRuleRows(rules),
    `Hands-on criteria: ${HANDS_ON_CRITERIA}`,
    `Capitalization threshold: ${CAPITALIZATION_THRESHOLD_GUIDANCE}`,
    "Framing constraints:",
    "- Manager Oversight is OpEx by default; capital treatment happens " +
      "only through the human hands-on exception checkbox. Never suggest " +
      "capex for it directly.",
    "- Business Enhancements is hard-ruled OpEx in the application. Your " +
      "suggestion for it is advisory review guidance only (candidate for " +
      "Finance/PMO elevation review), never a CapEx classification hint.",
    "Respond with classification, confidence (high/medium/low), a short " +
      "explanation, and judgmentCall (null unless the entry is a judgment " +
      "call).",
  ].join("\n\n");

  const contextLines = [
    `Entry under review: ${subject}.`,
    `Weekly hours: ${entry.weeklyHours}.`,
    entry.projectName
      ? `Project: #${entry.projectNumber ?? "?"} ${entry.projectName}.`
      : null,
    entry.note ? `Partner note: ${entry.note}` : null,
    entry.weekStartDate ? `Week start: ${entry.weekStartDate}.` : null,
  ].filter((line): line is string => line !== null);

  const prompt = [
    ...contextLines,
    judgmentGuidance,
    "Classify this entry and explain your reasoning.",
  ].join("\n");

  return { system, prompt };
}
