"use client";

// Phase 6 (D2/D3/D4): advisory AI classification panel. Suggestions are
// never stored and never set entry state automatically (D2) — the hands-on
// checkbox stays the existing user-driven control (TC-302); an explicit
// "Apply" click is the only path that writes it, through the same grid
// state the checkbox uses. Clear-cut codes render a deterministic echo
// fetched from the route (TC-301 — no model call); judgment calls stream a
// structured suggestion via useObject (TC-302/303). The panel hides itself
// entirely when the helper is unavailable (no TOKENROUTER_API_KEY — D4) and
// states low confidence on model failures (TC-305).
//
// APIs verified against the bundled, version-matched docs (ai@7.0.93,
// @ai-sdk/react@4.0.96): useObject({ api, schema }) → { object, submit,
// isLoading, error, clear, stop } with DeepPartial streaming objects.

import { useEffect, useRef, useState } from "react";
import { useObject } from "@ai-sdk/react";
import { Sparkles, X } from "lucide-react";

import {
  BUSINESS_ENHANCEMENTS_CATEGORY,
  classificationSuggestionSchema,
  isJudgmentCall,
  MANAGER_OVERSIGHT_CODE,
} from "@/lib/ai-classification";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface AiEntryContext {
  taskCodeName: string | null;
  nonProjectCategoryName: string | null;
  weeklyHours: number;
  projectName?: string | null;
  projectNumber?: number | null;
  note?: string | null;
  weekStartDate?: string | null;
  entryDate?: string | null;
}

interface AiSuggestionPanelProps {
  context: AiEntryContext;
  /** Manager Oversight only — invoked on the user's explicit click and
   * writes the existing TS-011 hands-on flag via the grid. The panel never
   * sets it automatically (TC-302). */
  onApplyHandsOn?: () => void;
}

type DeterministicEcho = "capex" | "opex";

// One availability probe per browser session — the key doesn't flip
// mid-edit, and the week grid can host many panels over a visit.
let availabilityProbe: Promise<boolean> | null = null;
function probeAvailability(): Promise<boolean> {
  availabilityProbe ??= fetch("/api/ai/classification", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : { available: false }))
    .then((data: { available?: boolean }) => data.available === true)
    .catch(() => false);
  return availabilityProbe;
}

// Clear-cut echoes are DB-derived rule lookups — cache per code/category +
// entry date so row switches don't refetch.
const echoCache = new Map<string, DeterministicEcho>();

export function AiSuggestionPanel(props: AiSuggestionPanelProps) {
  const { context } = props;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Fetched echoes are keyed by context so a stale fetch for a previous
  // code/category can never render for the current one (no reset needed).
  const [fetched, setFetched] = useState<{
    key: string;
    value: DeterministicEcho | "unavailable";
  } | null>(null);
  const [streamFailed, setStreamFailed] = useState(false);

  // Pure client-side routing (D3): judgment calls stream a suggestion,
  // clear-cut codes show the deterministic echo.
  const judgment = isJudgmentCall(
    context.taskCodeName,
    context.nonProjectCategoryName,
    context.weeklyHours,
  );

  const contextKey = JSON.stringify(context);

  const { object, submit, clear, error, isLoading } = useObject({
    api: "/api/ai/classification",
    schema: classificationSuggestionSchema,
    onFinish({ object: finished, error: finishError }) {
      // object is undefined when the final stream failed schema validation
      // (e.g. the route answered JSON because the key vanished mid-session).
      setStreamFailed(finishError !== undefined || finished === undefined);
    },
    onError() {
      setStreamFailed(true);
    },
  });

  // Hook identities are held in refs so the debounced effects below can't
  // re-trigger or re-submit when the hook returns new function instances.
  // The ref sync happens in an effect — refs must not be written during
  // render (react-hooks/refs).
  const contextRef = useRef(context);
  const submitRef = useRef(submit);
  const clearRef = useRef(clear);
  const lastSubmittedKey = useRef<string | null>(null);
  useEffect(() => {
    contextRef.current = context;
    submitRef.current = submit;
    clearRef.current = clear;
  });

  // Clear-cut codes: cache hit is derived during render; only cache misses
  // fetch (TC-301).
  const echoIdentifier = judgment
    ? null
    : (context.taskCodeName ?? context.nonProjectCategoryName);
  const echoKey = echoIdentifier
    ? `${echoIdentifier}|${context.entryDate ?? ""}`
    : null;
  const cachedEcho = echoKey ? (echoCache.get(echoKey) ?? null) : null;
  const echo =
    cachedEcho ?? (fetched?.key === echoKey ? fetched.value : null);

  useEffect(() => {
    let cancelled = false;
    probeAvailability().then((value) => {
      if (!cancelled) setAvailable(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Judgment calls: debounced submit so fast hour/note edits don't spam the
  // endpoint; identical contexts never re-submit.
  useEffect(() => {
    if (available !== true || dismissed || !judgment) return;
    const timer = setTimeout(() => {
      if (lastSubmittedKey.current === contextKey) return;
      lastSubmittedKey.current = contextKey;
      clearRef.current();
      setStreamFailed(false);
      submitRef.current(contextRef.current);
    }, 600);
    return () => clearTimeout(timer);
  }, [available, dismissed, judgment, contextKey]);

  // Clear-cut codes: deterministic echo from the route (TC-301). Cache hits
  // render directly; misses fetch once and store the result keyed by context.
  useEffect(() => {
    if (available !== true || dismissed || judgment || cachedEcho) return;
    if (!echoKey) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch("/api/ai/classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: contextKey,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          return (await res.json()) as {
            available?: boolean;
            deterministic?: DeterministicEcho | null;
          };
        })
        .then((data) => {
          if (cancelled) return;
          if (data.available === true && data.deterministic) {
            echoCache.set(echoKey, data.deterministic);
            setFetched({ key: echoKey, value: data.deterministic });
          } else {
            setFetched({ key: echoKey, value: "unavailable" });
          }
        })
        .catch(() => {
          if (!cancelled) setFetched({ key: echoKey, value: "unavailable" });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    available,
    dismissed,
    judgment,
    cachedEcho,
    echoKey,
    contextKey,
  ]);

  if (available !== true || dismissed) return null;

  // Clear-cut: small deterministic confirmation line (TC-301). An
  // unavailable echo renders nothing — the standard rule still applies.
  if (!judgment) {
    if (!echo || echo === "unavailable") return null;
    return (
      <p className="flex items-center gap-1.5 text-xs leading-snug text-muted-foreground">
        <Sparkles className="size-3 shrink-0 text-accent" aria-hidden="true" />
        Fixed rule: {echo === "capex" ? "CapEx" : "OpEx"} — set by the
        effective-dated classification rules.
      </p>
    );
  }

  const isManagerOversight =
    context.taskCodeName === MANAGER_OVERSIGHT_CODE;
  const isEnhancements =
    context.nonProjectCategoryName === BUSINESS_ENHANCEMENTS_CATEGORY;
  const lowConfidence = object?.confidence === "low";
  const guidance = object?.judgmentCall?.guidance;

  return (
    <div className="animate-scale-in flex flex-col gap-2 rounded-lg border border-border bg-background/30 p-2 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="micro-label flex items-center gap-1.5">
          <Sparkles className="size-3 text-accent" aria-hidden="true" />
          AI suggestion — advisory only
        </span>
        <button
          type="button"
          aria-label="Dismiss AI suggestion"
          onClick={() => setDismissed(true)}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {isLoading && !object ? (
        <p className="text-xs text-muted-foreground">
          Analyzing classification…
        </p>
      ) : null}

      {object?.explanation ? (
        <p className="text-xs leading-snug text-foreground">
          {object.explanation}
        </p>
      ) : null}

      {object?.confidence ? (
        <p>
          <Badge variant={lowConfidence ? "outline" : "secondary"}>
            {object.confidence} confidence
          </Badge>
        </p>
      ) : null}

      {/* The app hard-rules both judgment rows OpEx by default — the model's
          classification field is deliberately not rendered so no CapEx hint
          can ever appear (D2/TC-303). The human hands-on checkbox is the
          only capex path for Manager Oversight. */}
      {isManagerOversight ? (
        <p className="text-xs leading-snug text-muted-foreground">
          App rule: OpEx unless the hands-on exception applies — the checkbox
          below is your decision; this suggestion cannot set it.
        </p>
      ) : null}
      {isEnhancements ? (
        <p className="text-xs leading-snug text-muted-foreground">
          Standard treatment: OpEx — fixed by the app. Candidate for
          Finance/PMO elevation review.
        </p>
      ) : null}

      {guidance ? (
        <div className="rounded-md border border-primary/30 bg-primary/10 p-2">
          <p className="micro-label">
            {object?.judgmentCall?.kind === "capitalization_threshold"
              ? "Finance/PMO elevation review"
              : "Hands-on exception criteria"}
          </p>
          <p className="text-xs leading-snug text-foreground">{guidance}</p>
          {isManagerOversight && props.onApplyHandsOn ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                // Explicit user action only — writes the existing TS-011
                // flag through the grid's checkbox state (TC-302/D2).
                props.onApplyHandsOn?.();
                setDismissed(true);
              }}
            >
              Apply hands-on exception
            </Button>
          ) : null}
        </div>
      ) : null}

      {(error || streamFailed) && !object ? (
        <p className="text-xs leading-snug text-muted-foreground">
          AI suggestion unavailable — this entry stays on the standard rule.
        </p>
      ) : lowConfidence ? (
        <p className="text-xs leading-snug text-muted-foreground">
          Low confidence — deferring to the standard rule is advised.
        </p>
      ) : null}
    </div>
  );
}
