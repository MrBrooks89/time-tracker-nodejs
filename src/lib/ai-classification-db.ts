// Phase 6: DB loader for the AI helper's rule view. Joins classification
// rules with task-code names so the deterministic resolver and the prompt
// builder consume the exact same effective-dated rows the app classifies
// with (src/lib/classification.ts). Kept separate from the pure module so
// ai-classification.ts stays DB-free (Phase B constraint).

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { classificationRule, taskCode } from "@/db/schema";
import type { NamedRuleInfo } from "@/lib/ai-classification";

export async function loadNamedRules(): Promise<NamedRuleInfo[]> {
  return db
    .select({
      taskCodeId: classificationRule.taskCodeId,
      taskCodeName: taskCode.name,
      classification: classificationRule.classification,
      effectiveFrom: classificationRule.effectiveFrom,
      notes: classificationRule.notes,
    })
    .from(classificationRule)
    .innerJoin(taskCode, eq(classificationRule.taskCodeId, taskCode.id))
    .orderBy(taskCode.name, classificationRule.effectiveFrom);
}
