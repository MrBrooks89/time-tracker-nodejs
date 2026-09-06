import Link from "next/link";
import { and, asc, count, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLog as auditLogTable, user as userTable } from "@/db/schema";
import { requireRole } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Audit Trail" };

const PAGE_SIZE = 200;

// Actions that undo or flag problems read as destructive; decisions that
// advance the workflow read as primary; everything else is neutral.
const destructiveActions = new Set([
  "reject",
  "correction",
  "close_reopen",
  "person_deactivate",
  "project_deactivate",
]);
const primaryActions = new Set([
  "approve",
  "submit",
  "close_initiate",
  "close_finalize",
]);

function actionVariant(action: string): "default" | "secondary" | "destructive" {
  if (destructiveActions.has(action)) return "destructive";
  if (primaryActions.has(action)) return "default";
  return "secondary";
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}

// Values are compact JSON or short strings; clip pathological payloads so the
// table stays scannable.
function clip(value: string | null): string {
  if (!value) return "—";
  return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}

interface Filters {
  action: string;
  entity: string;
  actor: string;
  page: number;
}

function buildHref(filters: Filters, overrides: Partial<Filters>): string {
  const params = new URLSearchParams();
  const merged = { ...filters, ...overrides };
  if (merged.action) params.set("action", merged.action);
  if (merged.entity) params.set("entity", merged.entity);
  if (merged.actor) params.set("actor", merged.actor);
  if (merged.page > 0) params.set("page", String(merged.page));
  const qs = params.toString();
  return qs ? `/audit?${qs}` : "/audit";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; actor?: string; page?: string }>;
}) {
  // Server-side gate: non-admins are redirected to the dashboard.
  await requireRole(["admin"]);
  const params = await searchParams;

  const filters: Filters = {
    action: params.action ?? "",
    entity: params.entity ?? "",
    actor: params.actor ?? "",
    page: Math.max(0, Number(params.page ?? "0") || 0),
  };

  const conditions = [];
  if (filters.action) conditions.push(eq(auditLogTable.action, filters.action));
  if (filters.entity) conditions.push(eq(auditLogTable.entityType, filters.entity));
  if (filters.actor) conditions.push(eq(auditLogTable.actorId, filters.actor));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // One extra row beyond the page size tells us whether "load more" applies.
  const [rows, filterOptions, [total]] = await Promise.all([
    db
      .select({
        id: auditLogTable.id,
        actorName: userTable.name,
        action: auditLogTable.action,
        entityType: auditLogTable.entityType,
        entityId: auditLogTable.entityId,
        field: auditLogTable.field,
        oldValue: auditLogTable.oldValue,
        newValue: auditLogTable.newValue,
        reason: auditLogTable.reason,
        createdAt: auditLogTable.createdAt,
      })
      .from(auditLogTable)
      .innerJoin(userTable, eq(auditLogTable.actorId, userTable.id))
      .where(where)
      .orderBy(desc(auditLogTable.createdAt))
      .limit(PAGE_SIZE + 1)
      .offset(filters.page * PAGE_SIZE),
    Promise.all([
      db
        .selectDistinct({ value: auditLogTable.action })
        .from(auditLogTable)
        .orderBy(asc(auditLogTable.action)),
      db
        .selectDistinct({ value: auditLogTable.entityType })
        .from(auditLogTable)
        .orderBy(asc(auditLogTable.entityType)),
      db
        .selectDistinct({ id: userTable.id, name: userTable.name })
        .from(auditLogTable)
        .innerJoin(userTable, eq(auditLogTable.actorId, userTable.id))
        .orderBy(asc(userTable.name)),
    ]),
    db.select({ value: count() }).from(auditLogTable).where(where),
  ]);

  const [actions, entityTypes, actors] = filterOptions;
  const hasMore = rows.length > PAGE_SIZE;
  const visibleRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-2 p-8">
        <p className="micro-label">Compliance / DA-009</p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Audit trail
        </h1>
        <p className="text-sm text-muted-foreground">
          Append-only record of submissions, approvals, corrections, close
          events, and admin changes. Newest first · {Number(total?.value ?? 0)}{" "}
          matching events
        </p>
      </section>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Audit / Filters</p>
          <CardTitle>Filter events</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            method="get"
            action="/audit"
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex flex-col gap-2 sm:w-56">
              <Label htmlFor="audit-action">Action</Label>
              <Select
                id="audit-action"
                name="action"
                defaultValue={filters.action}
              >
                <option value="">All actions</option>
                {actions.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-2 sm:w-48">
              <Label htmlFor="audit-entity">Entity type</Label>
              <Select
                id="audit-entity"
                name="entity"
                defaultValue={filters.entity}
              >
                <option value="">All entities</option>
                {entityTypes.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-2 sm:w-56">
              <Label htmlFor="audit-actor">Actor</Label>
              <Select id="audit-actor" name="actor" defaultValue={filters.actor}>
                <option value="">All actors</option>
                {actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <button
              type="submit"
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-border bg-secondary/40 px-5 text-sm font-bold tracking-tight text-foreground backdrop-blur-sm transition-all duration-200 outline-none hover:-translate-y-0.5 hover:border-primary/60 hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Apply
            </button>
          </form>
        </CardContent>
      </Card>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Audit / Events</p>
          <CardTitle className="flex flex-wrap items-center gap-3">
            Events
            <Badge variant="secondary">
              page {filters.page + 1} · {visibleRows.length} rows
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visibleRows.length === 0 ? (
            <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
              <p className="micro-label">NO AUDIT EVENTS MATCH THE FILTERS</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Old → New</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {formatTimestamp(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {row.actorName}
                      </TableCell>
                      <TableCell>
                        <Badge variant={actionVariant(row.action)}>
                          {row.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.entityType}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortId(row.entityId)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.field ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs break-all">
                        {row.oldValue ? `${clip(row.oldValue)} → ` : ""}
                        {clip(row.newValue)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.reason ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {hasMore ? (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <Link
                    href={buildHref(filters, { page: filters.page - 1 })}
                    aria-disabled={filters.page === 0}
                    className="text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
                  >
                    ← Newer
                  </Link>
                  <Link
                    href={buildHref(filters, { page: filters.page + 1 })}
                    className="text-sm font-semibold text-primary transition-colors hover:text-primary/80"
                  >
                    Load more →
                  </Link>
                </div>
              ) : filters.page > 0 ? (
                <div className="mt-4">
                  <Link
                    href={buildHref(filters, { page: filters.page - 1 })}
                    className="text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
                  >
                    ← Newer
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
