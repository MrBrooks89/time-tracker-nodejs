// Phase 6 (D1–D4): advisory AI classification endpoint. Deterministic-first
// (D3): clear-cut codes resolve from the effective-dated classification
// rules with no model call; judgment calls stream a structured suggestion
// through TokenRouter's OpenAI-compatible endpoint (TOKENROUTER_API_KEY,
// @ai-sdk/openai-compatible provider). Suggestions are advisory only (D2) —
// nothing here writes classification. No API key → { available: false } and
// the client hides the helper (D4/TC-305). Streaming pattern verified
// against the bundled docs shipped with ai@7.0.93 (streamText +
// Output.object → createTextStreamResponse + toTextStream, consumed
// client-side by useObject).

import {
  Output,
  createTextStreamResponse,
  extractJsonMiddleware,
  streamText,
  toTextStream,
  wrapLanguageModel,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { user as userTable } from "@/db/schema";
import {
  buildSuggestionPrompt,
  classificationSuggestionSchema,
  isJudgmentCall,
  resolveDeterministic,
  type EntryContext,
} from "@/lib/ai-classification";
import { loadNamedRules } from "@/lib/ai-classification-db";
import { getSessionUser } from "@/lib/session";
import { getSettings } from "@/lib/settings-db";

// Allow streaming responses up to 30 seconds (route segment config).
export const maxDuration = 30;

// Fallback when the ai_model setting is empty. TokenRouter exposes
// provider/model model IDs; an OpenAI-class model is the default because
// the structured-output path (Output.object) needs JSON schema support —
// several routed providers (Anthropic, Gemini) lack JSON mode through the
// OpenAI-compat layer.
const DEFAULT_ROUTER_MODEL = "openai/gpt-5.6-sol";
const DEFAULT_TOKENROUTER_BASE_URL = "https://api.tokenrouter.com/v1";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Request body: the entry context under review. Optional fields are
// request-validation sugar only — the strictJsonSchema/.nullable() constraint
// applies to the model OUTPUT schema (classificationSuggestionSchema), not
// here.
const entryContextSchema = z
  .object({
    taskCodeName: z.string().min(1).nullable(),
    nonProjectCategoryName: z.string().min(1).nullable(),
    weeklyHours: z.number().min(0).max(168),
    projectName: z.string().max(300).nullable().optional(),
    projectNumber: z.number().int().nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    weekStartDate: z.string().regex(DATE_PATTERN).nullable().optional(),
    entryDate: z.string().regex(DATE_PATTERN).nullable().optional(),
  })
  .refine(
    (value) =>
      value.taskCodeName !== null || value.nonProjectCategoryName !== null,
    { message: "An entry needs a task code or a non-project category." },
  );

function hasRouterKey(): boolean {
  const key = process.env.TOKENROUTER_API_KEY;
  return typeof key === "string" && key.length > 0;
}

// Availability probe for the client panel (D4): the panel hides itself
// entirely when the helper is unavailable. Session-guarded so the endpoint
// only answers to signed-in users.
export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json({ available: hasRouterKey() });
}

export async function POST(request: Request) {
  // Guard 1: valid session. (requireUser redirects — wrong shape for an API
  // route; getSessionUser is the same underlying check without the redirect.)
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Guard 2: requireUser does NOT check isActive — deactivated users with
  // live sessions must be rejected, so query the user row explicitly.
  const [row] = await db
    .select({ isActive: userTable.isActive })
    .from(userTable)
    .where(eq(userTable.id, sessionUser.id))
    .limit(1);
  if (!row || row.isActive !== true) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = entryContextSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const entry = parsed.data;

  const [settings, rules] = await Promise.all([
    getSettings(),
    loadNamedRules(),
  ]);

  // Effective-dating anchor for the deterministic resolution: the entry's
  // own date when provided, else the week start, else today.
  const entryDate =
    entry.entryDate ?? entry.weekStartDate ?? new Date().toISOString().slice(0, 10);

  // D3 (TC-301): clear-cut codes never reach the model. Resolution
  // delegates to the same effective-dated rules the app classifies with.
  // Non-project entries are hard-ruled OpEx (classifyNonProjectEntry).
  if (
    !isJudgmentCall(
      entry.taskCodeName,
      entry.nonProjectCategoryName,
      entry.weeklyHours,
    )
  ) {
    const deterministic = entry.taskCodeName
      ? resolveDeterministic(entry.taskCodeName, rules, entryDate)
      : "opex";
    return Response.json({ available: true, deterministic, suggestion: null });
  }

  // D4 (TC-305): no API key — the helper defers to the default rule. The
  // client probes availability first, so this path is defensive only.
  if (!hasRouterKey()) {
    return Response.json({
      available: false,
      deterministic: null,
      suggestion: null,
    });
  }

  const context: EntryContext = {
    taskCodeName: entry.taskCodeName,
    nonProjectCategoryName: entry.nonProjectCategoryName,
    weeklyHours: entry.weeklyHours,
    projectName: entry.projectName ?? null,
    projectNumber: entry.projectNumber ?? null,
    note: entry.note ?? null,
    weekStartDate: entry.weekStartDate ?? null,
  };

  const { system, prompt } = buildSuggestionPrompt(context, rules);
  const baseURL =
    process.env.TOKENROUTER_BASE_URL?.trim() || DEFAULT_TOKENROUTER_BASE_URL;
  const router = createOpenAICompatible({
    name: "tokenrouter",
    baseURL,
    apiKey: process.env.TOKENROUTER_API_KEY ?? "",
    // Provider-level flag (the per-model config arg is ignored by the
    // implementation). Without it the compat provider drops the
    // JSON-schema response format and Output.object can't parse the
    // free-form prose the model answers with.
    supportsStructuredOutputs: true,
  });
  // extractJsonMiddleware strips markdown fences some models wrap around
  // the JSON payload.
  const model = wrapLanguageModel({
    model: router.languageModel(settings.aiModel.trim() || DEFAULT_ROUTER_MODEL),
    middleware: extractJsonMiddleware(),
  });

  // D4 (TC-305): model errors degrade gracefully — the client falls back to
  // the standard rule and the entry flow is unaffected.
  const result = (() => {
    try {
      return streamText({
        model,
        system,
        prompt,
        output: Output.object({ schema: classificationSuggestionSchema }),
        onError({ error }) {
          console.error("[ai/classification] stream error:", error);
        },
      });
    } catch (error) {
      console.error("[ai/classification] model setup failed:", error);
      return null;
    }
  })();

  if (!result) {
    return Response.json({
      available: true,
      deterministic: null,
      suggestion: null,
      error: "low_confidence",
    });
  }

  // Chunked JSON text stream matching classificationSuggestionSchema — the
  // documented useObject counterpart (bundled ai@7.0.93 object-generation
  // docs). Mid-stream provider errors surface as a truncated stream; the
  // client treats a failed/invalid final object as low confidence.
  return createTextStreamResponse({
    stream: toTextStream({ stream: result.stream }),
  });
}
