// Pure locked-period correction rules (TS-028 + TS-026 + TS-029 restating).
// Mirrors the project convention of keeping domain logic side-effect free:
// this module never touches the DB, so server actions compose these helpers
// and the unit tests run without any database.
//
// A correction is the ONLY way hours/notes change inside a LOCKED week. It
// always requires a non-empty reason and produces a correction_log payload
// capturing the original → new values alongside the acting admin.

import { isValidHoursIncrement } from "./entry-validation.ts";

export type CorrectionCheck = { ok: true } | { ok: false; error: string };

const REASON_REQUIRED = "A reason is required for every correction.";
const HOURS_INVALID =
  "Hours must be zero or positive, in 0.25 increments.";

// The reason is the compliance core of TS-026: blank or whitespace-only
// reasons are rejected before anything is written.
export function validateCorrectionReason(
  reason: string | null | undefined,
): CorrectionCheck {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { ok: false, error: REASON_REQUIRED };
  }
  return { ok: true };
}

// Full correction-input validation: reason first (mandatory), then the
// corrected hours (0.25 increments, non-negative — 0 is allowed so an
// erroneous entry can be zeroed out).
export function validateCorrection(input: {
  reason: string | null | undefined;
  hours: number;
}): CorrectionCheck {
  const reasonCheck = validateCorrectionReason(input.reason);
  if (!reasonCheck.ok) return reasonCheck;
  if (!isValidHoursIncrement(input.hours)) {
    return { ok: false, error: HOURS_INVALID };
  }
  return { ok: true };
}

// Canonical hour encoding for log values: quarter-rounded so float drift
// (7.749999 vs 7.75) never produces noisy log entries.
export function formatHoursValue(hours: number): string {
  const rounded = Math.round(hours * 4) / 4;
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(Number(rounded.toFixed(2)));
}

export interface CorrectionValueInput {
  originalHours: number;
  newHours: number;
  originalNote: string | null;
  newNote: string | null;
}

export interface CorrectionValues {
  /** False when the entry is untouched — such entries are not logged. */
  changed: boolean;
  /** Which fields the correction touches (for the audit trail). */
  field: "hours" | "hours,note";
  /** e.g. "hours=8" or "hours=8; note=client workshop". */
  originalValue: string;
  newValue: string;
}

// Builds the correction_log / audit_log value pair. Hours are always part of
// the payload; the note is included only when it actually changed. Values are
// compared on quarter-rounded hours so float noise never flags fake changes.
export function buildCorrectionValues(
  input: CorrectionValueInput,
): CorrectionValues {
  const hoursChanged =
    Math.round(input.originalHours * 4) !== Math.round(input.newHours * 4);
  const originalNote = input.originalNote ?? "";
  const newNote = input.newNote ?? "";
  const noteChanged = originalNote !== newNote;

  if (!hoursChanged && !noteChanged) {
    return { changed: false, field: "hours", originalValue: "", newValue: "" };
  }

  const join = (hours: number, note: string | null, includeNote: boolean) =>
    includeNote
      ? `hours=${formatHoursValue(hours)}; note=${note ?? ""}`
      : `hours=${formatHoursValue(hours)}`;

  return {
    changed: true,
    field: noteChanged ? "hours,note" : "hours",
    originalValue: join(input.originalHours, originalNote, noteChanged),
    newValue: join(input.newHours, newNote, noteChanged),
  };
}

// TS-029: only corrections made AFTER a period was finalized restate the
// reported figures. The period_close row carries no string status — its
// finality is expressed by closedAt (null = close initiated but the
// correction window is still open / not yet finalized, per the schema).
// A missing close row means the period was never even initiated, so
// there is nothing to restate either. Kept pure so the bump decision is
// unit-testable without a database.
export function shouldMarkRestated(
  close: { closedAt: Date | null } | null | undefined,
): boolean {
  return close?.closedAt != null;
}
