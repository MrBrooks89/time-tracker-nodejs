import { auditLog, type NewAuditLog } from "@/db/schema";

// Minimal structural type for a drizzle better-sqlite3 database OR
// transaction handle. better-sqlite3 statement execution is synchronous, so
// the audit insert uses .run() and works inside db.transaction((tx) => ...)
// callbacks as well as against the plain db.
export type AuditDb = {
  insert: (table: typeof auditLog) => {
    values: (row: NewAuditLog) => { run: () => unknown };
  };
};

export interface AuditEvent {
  /** Who performed the action (the acting user, not the resource owner). */
  actorId: string;
  /** e.g. "delegated_save", "delegated_submit", "save", "submit". */
  action: string;
  /** e.g. "timesheet", "time_entry", "period_close". */
  entityType: string;
  /** Primary key of the audited entity. */
  entityId: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
}

// Append-only audit trail writer (DA-009). Never updates or deletes — one
// row per event. Safe to call inside a transaction for atomicity with the
// change being audited.
export function recordAudit(tx: AuditDb, event: AuditEvent): void {
  tx.insert(auditLog)
    .values({
      id: crypto.randomUUID(),
      actorId: event.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      field: event.field ?? null,
      oldValue: event.oldValue ?? null,
      newValue: event.newValue ?? null,
      reason: event.reason ?? null,
    })
    .run();
}
