export interface RuleInfo {
  taskCodeId: string;
  classification: "capex" | "opex";
  effectiveFrom: string;
  notes: string | null;
}

export type Classification = "capex" | "opex";

export function classifyProjectEntry(
  taskCodeId: string,
  rules: RuleInfo[],
  entryDate: string,
): Classification | null {
  let resolved: RuleInfo | null = null;
  for (const rule of rules) {
    if (
      rule.taskCodeId === taskCodeId &&
      rule.effectiveFrom <= entryDate &&
      (!resolved || rule.effectiveFrom > resolved.effectiveFrom)
    ) {
      resolved = rule;
    }
  }
  return resolved ? resolved.classification : null;
}

export function classifyEntry(
  taskCodeId: string,
  taskCodeName: string,
  rules: RuleInfo[],
  entryDate: string,
  isHandsOn: boolean,
): Classification | null {
  const resolved = classifyProjectEntry(taskCodeId, rules, entryDate);
  if (resolved === null) return null;
  if (taskCodeName === "Manager Oversight" && isHandsOn) {
    return "capex";
  }
  return resolved;
}

export function classifyNonProjectEntry(): Classification {
  return "opex";
}
