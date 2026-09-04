import Link from "next/link";
import { Download } from "lucide-react";

import { FISCAL_PERIODS } from "@/lib/fiscal";
import { canManagePeople } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import {
  getActualsReport,
  getClassificationReport,
  getComplianceReport,
  getReportOptions,
  getSpendDashboard,
  resolveScope,
} from "@/lib/reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

export const metadata = { title: "Reports" };

const reportTabs = [
  { key: "dashboard", label: "Time Spend" },
  { key: "actuals", label: "Period Actuals" },
  { key: "compliance", label: "Compliance" },
  { key: "classification", label: "CapEx / OpEx" },
];

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 4) / 4;
  const formatted = Number.isInteger(rounded)
    ? String(rounded)
    : String(Number(rounded.toFixed(2)));
  return `${formatted}h`;
}

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function exportHref(params: Record<string, string | undefined>, tab: string): string {
  const search = new URLSearchParams();
  search.set("tab", tab);
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return `/reports/export?${search.toString()}`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="paper-card animate-scale-in flex flex-col gap-1.5 rounded-2xl p-5">
      <p className="micro-label">{label}</p>
      <p className="font-display text-2xl font-bold tracking-tight">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
      <p className="micro-label">{message}</p>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    week?: string;
    year?: string;
    period?: string;
    quarter?: string;
    team?: string;
    managerId?: string;
    projectId?: string;
    userId?: string;
    categoryId?: string;
  }>;
}) {
  const viewer = await requireUser();
  const params = await searchParams;
  const canManage = canManagePeople(viewer.role);

  const scopeData = resolveScope({
    week: params.week,
    year: params.year,
    period: params.period,
    quarter: params.quarter,
  });
  if (!scopeData) {
    return (
      <div className="flex flex-col gap-6">
        <section className="glass-panel animate-fade-up flex flex-col gap-2 p-8">
          <p className="micro-label">Insights / Reporting</p>
          <h1 className="font-display text-3xl font-bold tracking-tight">Reports</h1>
        </section>
        <EmptyState message="UNKNOWN FISCAL RANGE" />
      </div>
    );
  }

  const tab = reportTabs.some((t) => t.key === params.tab) ? params.tab! : "dashboard";

  const filters = {
    team: canManage ? params.team : undefined,
    managerId: canManage ? params.managerId : undefined,
    projectId: params.projectId,
    userId: canManage ? params.userId : undefined,
    categoryId: params.categoryId,
  };

  const optionsPromise = getReportOptions();
  const currentParams = {
    week: params.week,
    year: params.year,
    period: params.period,
    quarter: params.quarter,
    team: filters.team,
    managerId: filters.managerId,
    projectId: filters.projectId,
    userId: filters.userId,
    categoryId: filters.categoryId,
  };

  const scopeLinkBase = (extra: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...currentParams, ...extra })) {
      if (value) search.set(key, value);
    }
    return `/reports?${search.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel animate-fade-up flex flex-col gap-4 p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2">
            <p className="micro-label">Insights / Reporting</p>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Reports
            </h1>
            <p className="text-sm text-muted-foreground">
              {scopeData.label} · {formatDateShort(scopeData.from)} – {formatDateShort(scopeData.to)}
            </p>
          </div>
          <Link
            href={exportHref(currentParams, tab)}
            prefetch={false}
            className="command-strip inline-flex h-10 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-bold tracking-tight text-primary-foreground shadow-[0_10px_32px_-12px_var(--primary)] outline-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_38px_-12px_var(--primary)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Download className="size-4" />
            Export
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {reportTabs.map((t) => (
            <Link
              key={t.key}
              href={scopeLinkBase({ tab: t.key })}
              aria-current={t.key === tab ? "page" : undefined}
              className={
                t.key === tab
                  ? "rounded-full border border-primary/30 bg-primary/15 px-4 py-1.5 text-sm font-bold text-primary"
                  : "rounded-full border border-border bg-secondary/40 px-4 py-1.5 text-sm font-semibold text-muted-foreground transition-all hover:-translate-y-0.5 hover:text-foreground"
              }
            >
              {t.label}
            </Link>
          ))}
        </div>
      </section>
      <ReportsBody
        viewer={viewer}
        tab={tab}
        scopeData={scopeData}
        filters={filters}
        options={optionsPromise}
        currentParams={currentParams}
      />
    </div>
  );
}

async function ReportsBody({
  viewer,
  tab,
  scopeData,
  filters,
  options,
  currentParams,
}: {
  viewer: Awaited<ReturnType<typeof requireUser>>;
  tab: string;
  scopeData: { scope: Parameters<typeof getActualsReport>[1]; label: string; from: string; to: string };
  filters: Record<string, string | undefined>;
  options: Promise<Awaited<ReturnType<typeof getReportOptions>>>;
  currentParams: Record<string, string | undefined>;
}) {
  const opts = await options;
  const filterControls = <FilterControls opts={opts} currentParams={currentParams} canManage={viewer.role !== "employee"} />;

  if (tab === "dashboard") {
    const data = await getSpendDashboard(viewer, filters);
    const pct = (v: number, total: number) =>
      total > 0 ? `${Math.round((v / total) * 100)}%` : "—";

    return (
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Total hours" value={formatHours(data.current.total)} sub={data.current.label} />
          <StatTile
            label="Project investment"
            value={formatHours(data.current.projectHours)}
            sub={pct(data.current.projectHours, data.current.total)}
          />
          <StatTile
            label="Sustaining operations"
            value={formatHours(data.current.supportHours)}
            sub={pct(data.current.supportHours, data.current.total)}
          />
          <StatTile
            label="CapEx / OpEx"
            value={`${formatHours(data.current.capex)} / ${formatHours(data.current.opex)}`}
            sub={pct(data.current.capex, data.current.total)}
          />
        </div>

        <Card className="animate-scale-in">
          <CardHeader>
            <p className="micro-label">Filters / Scope</p>
            <CardTitle>Trend over trailing periods</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {filterControls}
            <TrendChart trend={data.trend} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="animate-scale-in">
            <CardHeader>
              <p className="micro-label">Drill-down / Team</p>
              <CardTitle>By team</CardTitle>
            </CardHeader>
            <CardContent>
              {data.byTeam.length === 0 ? (
                <EmptyState message="NO DATA IN RANGE" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Support</TableHead>
                      <TableHead>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byTeam.map((row) => (
                      <TableRow key={row.team}>
                        <TableCell className="text-sm font-medium">{row.team}</TableCell>
                        <TableCell className="font-mono text-xs">{formatHours(row.projectHours)}</TableCell>
                        <TableCell className="font-mono text-xs">{formatHours(row.supportHours)}</TableCell>
                        <TableCell className="font-mono text-xs font-semibold">{formatHours(row.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="animate-scale-in">
            <CardHeader>
              <p className="micro-label">Drill-down / Manager</p>
              <CardTitle>By manager</CardTitle>
            </CardHeader>
            <CardContent>
              {data.byManager.length === 0 ? (
                <EmptyState message="NO DATA IN RANGE" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Manager</TableHead>
                      <TableHead>Team hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byManager.map((row) => (
                      <TableRow key={row.manager}>
                        <TableCell className="text-sm font-medium">{row.manager}</TableCell>
                        <TableCell className="font-mono text-xs">{formatHours(row.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (tab === "actuals") {
    const report = await getActualsReport(viewer, scopeData.scope, scopeData.label, filters);
    return (
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Total hours" value={formatHours(report.total)} />
          <StatTile label="CapEx" value={formatHours(report.capex)} />
          <StatTile label="OpEx" value={formatHours(report.opex)} />
          <StatTile
            label="Prior period"
            value={report.prior ? formatHours(report.prior.total) : "—"}
            sub={report.prior ? report.prior.label : "No prior data"}
          />
        </div>

        <Card className="animate-scale-in">
          <CardHeader>
            <p className="micro-label">Filters / Scope</p>
            <CardTitle>Scope</CardTitle>
          </CardHeader>
          <CardContent>{filterControls}</CardContent>
        </Card>

        <Card className="animate-scale-in">
          <CardHeader>
            <p className="micro-label">Breakdown / Partner</p>
            <CardTitle>Hours by partner</CardTitle>
          </CardHeader>
          <CardContent>
            {report.byPartner.length === 0 ? (
              <EmptyState message="NO ENTRIES IN RANGE" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Entries</TableHead>
                    <TableHead>Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.byPartner.slice(0, 15).map((row) => (
                    <TableRow key={row.label}>
                      <TableCell className="text-sm font-medium">{row.label}</TableCell>
                      <TableCell className="font-mono text-xs">{row.entries}</TableCell>
                      <TableCell className="font-mono text-xs">{formatHours(row.hours)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="animate-scale-in">
            <CardHeader>
              <p className="micro-label">Breakdown / Project</p>
              <CardTitle>Hours by project</CardTitle>
            </CardHeader>
            <CardContent>
              {report.byProject.length === 0 ? (
                <EmptyState message="NO ENTRIES IN RANGE" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Entries</TableHead>
                      <TableHead>Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byProject.map((row) => (
                      <TableRow key={row.label}>
                        <TableCell className="text-sm font-medium">{row.label}</TableCell>
                        <TableCell className="font-mono text-xs">{row.entries}</TableCell>
                        <TableCell className="font-mono text-xs">{formatHours(row.hours)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="animate-scale-in">
            <CardHeader>
              <p className="micro-label">Breakdown / Category</p>
              <CardTitle>Hours by non-project category</CardTitle>
            </CardHeader>
            <CardContent>
              {report.byCategory.length === 0 ? (
                <EmptyState message="NO ENTRIES IN RANGE" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Entries</TableHead>
                      <TableHead>Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byCategory.map((row) => (
                      <TableRow key={row.label}>
                        <TableCell className="text-sm font-medium">{row.label}</TableCell>
                        <TableCell className="font-mono text-xs">{row.entries}</TableCell>
                        <TableCell className="font-mono text-xs">{formatHours(row.hours)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (tab === "compliance") {
    const rows = await getComplianceReport(viewer, scopeData.scope);
    const outstanding = rows.filter((r) => r.state !== "submitted" && r.state !== "locked");
    return (
      <div className="flex flex-col gap-6">
        <Card className="animate-scale-in">
          <CardHeader>
            <p className="micro-label">Filters / Scope</p>
            <CardTitle>Scope</CardTitle>
          </CardHeader>
          <CardContent>{filterControls}</CardContent>
        </Card>

        <Card className="animate-scale-in">
          <CardHeader>
            <p className="micro-label">Compliance / Submission</p>
            <CardTitle className="flex items-center gap-3">
              Timesheet compliance
              <Badge variant="secondary">{outstanding.length} outstanding</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState message="NO TIMESHEETS IN RANGE" />
            ) : outstanding.length === 0 ? (
              <div className="blueprint-surface flex min-h-24 items-center justify-center rounded-xl p-8">
                <p className="text-sm text-muted-foreground">
                  All timesheets in range are submitted or locked.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Week</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outstanding
                    .slice(0, 30)
                    .map((row) => (
                      <TableRow key={`${row.userId}-${row.weekStartDate}`}>
                        <TableCell className="text-sm font-medium">{row.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.team ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{formatDateShort(row.weekStartDate)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.state.replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{formatHours(row.totalHours)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const classification = await getClassificationReport(viewer, scopeData.scope, filters);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Total hours" value={formatHours(classification.total.hours)} />
        <StatTile label="CapEx" value={formatHours(classification.total.capex)} />
        <StatTile label="OpEx" value={formatHours(classification.total.opex)} />
      </div>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Filters / Scope</p>
          <CardTitle>Scope</CardTitle>
        </CardHeader>
        <CardContent>{filterControls}</CardContent>
      </Card>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Classification / Task Code</p>
          <CardTitle>Hours by task code</CardTitle>
        </CardHeader>
        <CardContent>
          {classification.byTaskCode.length === 0 ? (
            <EmptyState message="NO ENTRIES IN RANGE" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task code / category</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>CapEx</TableHead>
                  <TableHead>OpEx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classification.byTaskCode.map((row) => (
                  <TableRow key={row.taskCodeName}>
                    <TableCell className="text-sm font-medium">{row.taskCodeName}</TableCell>
                    <TableCell className="font-mono text-xs">{formatHours(row.hours)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatHours(row.capex)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatHours(row.opex)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="animate-scale-in">
        <CardHeader>
          <p className="micro-label">Classification / Project</p>
          <CardTitle>Hours by project and task code</CardTitle>
        </CardHeader>
        <CardContent>
          {classification.byProject.length === 0 ? (
            <EmptyState message="NO ENTRIES IN RANGE" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Task code</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>CapEx</TableHead>
                  <TableHead>OpEx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classification.byProject.slice(0, 25).map((row) => (
                  <TableRow key={`${row.projectName}-${row.taskCodeName}`}>
                    <TableCell className="text-sm font-medium">{row.projectName}</TableCell>
                    <TableCell className="text-sm">{row.taskCodeName}</TableCell>
                    <TableCell className="font-mono text-xs">{formatHours(row.hours)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatHours(row.capex)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatHours(row.opex)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterControls({
  opts,
  currentParams,
  canManage,
}: {
  opts: Awaited<ReturnType<typeof getReportOptions>>;
  currentParams: Record<string, string | undefined>;
  canManage: boolean;
}) {
  const years = [...new Set(FISCAL_PERIODS.map((p) => p.fiscalYear))];
  return (
    <form method="get" action="/reports" className="flex flex-col gap-4">
      <input type="hidden" name="tab" value={currentParams.tab ?? "dashboard"} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fiscal-year">Fiscal year</Label>
          <Select id="fiscal-year" name="year" defaultValue={currentParams.year ?? ""}>
            <option value="">Current</option>
            {years.map((y) => (
              <option key={y} value={y}>
                FY{y}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fiscal-period">Period</Label>
          <Select id="fiscal-period" name="period" defaultValue={currentParams.period ?? ""}>
            <option value="">—</option>
            {[...new Set(FISCAL_PERIODS.map((p) => p.periodNumber))].map((p) => (
              <option key={p} value={p}>
                P{p}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fiscal-quarter">Quarter</Label>
          <Select id="fiscal-quarter" name="quarter" defaultValue={currentParams.quarter ?? ""}>
            <option value="">—</option>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fiscal-week">Week start</Label>
          <Input
            id="fiscal-week"
            name="week"
            type="date"
            defaultValue={currentParams.week ?? ""}
          />
        </div>
        {canManage ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="filter-team">Team</Label>
            <Select id="filter-team" name="team" defaultValue={currentParams.team ?? ""}>
              <option value="">All teams</option>
              {opts.teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {canManage ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="filter-manager">Manager</Label>
            <Select id="filter-manager" name="managerId" defaultValue={currentParams.managerId ?? ""}>
              <option value="">All managers</option>
              {opts.managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="filter-project">Project</Label>
          <Select id="filter-project" name="projectId" defaultValue={currentParams.projectId ?? ""}>
            <option value="">All projects</option>
            {opts.projects.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.number} {p.name}
              </option>
            ))}
          </Select>
        </div>
        {canManage ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="filter-user">Partner</Label>
            <Select id="filter-user" name="userId" defaultValue={currentParams.userId ?? ""}>
              <option value="">All partners</option>
              {opts.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="filter-category">Category</Label>
          <Select id="filter-category" name="categoryId" defaultValue={currentParams.categoryId ?? ""}>
            <option value="">All categories</option>
            {opts.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit">Apply filters</Button>
        <Link
          href="/reports"
          className="rounded-sm text-sm font-semibold text-primary outline-none transition-colors hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Clear
        </Link>
      </div>
    </form>
  );
}

function TrendChart({
  trend,
}: {
  trend: Array<{ label: string; projectHours: number; supportHours: number; total: number }>;
}) {
  if (trend.length === 0) {
    return <EmptyState message="NO TREND DATA" />;
  }

  const width = 800;
  const height = 280;
  const padding = { top: 16, right: 16, bottom: 40, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maxHours = Math.max(...trend.map((t) => t.total), 1);
  const magnitude = 10 ** Math.floor(Math.log10(maxHours));
  const axisMax = (() => {
    for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
      const candidate = step * magnitude;
      if (maxHours <= candidate) return candidate;
    }
    return 10 * magnitude;
  })();

  const gridlines = Array.from({ length: 4 }, (_, i) => {
    const fraction = (i + 1) / 4;
    return {
      y: padding.top + plotHeight - fraction * plotHeight,
      value: axisMax * fraction,
    };
  });

  const slot = trend.length > 0 ? plotWidth / trend.length : plotWidth;
  const barWidth = Math.max(4, Math.min(40, slot * 0.6));

  const summaryText = trend
    .map((t) => `${t.label}: project ${t.projectHours}h, support ${t.supportHours}h`)
    .join("; ");

  return (
    <figure className="flex w-full flex-col gap-3">
      <div
        role="img"
        aria-label={`Stacked bar chart of project versus support hours across ${trend.length} periods. ${summaryText}`}
        className="blueprint-surface w-full overflow-hidden rounded-xl p-4"
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-auto w-full"
          aria-hidden="true"
          focusable="false"
        >
          {gridlines.map((line) => (
            <g key={line.value}>
              <line
                x1={padding.left}
                y1={line.y}
                x2={width - padding.right}
                y2={line.y}
                className="stroke-border"
                strokeWidth="1"
              />
              <text
                x={padding.left - 8}
                y={line.y + 4}
                textAnchor="end"
                className="fill-muted-foreground font-mono"
                fontSize="11"
              >
                {String(Math.round(line.value))}
              </text>
            </g>
          ))}
          {trend.map((t, i) => {
            const x = padding.left + i * slot + (slot - barWidth) / 2;
            const projectH = (t.projectHours / axisMax) * plotHeight;
            const supportH = (t.supportHours / axisMax) * plotHeight;
            const baseY = padding.top + plotHeight;
            return (
              <g key={t.label}>
                <rect
                  x={x}
                  y={baseY - projectH}
                  width={barWidth}
                  height={projectH}
                  className="fill-chart-1"
                  rx="2"
                >
                  <title>{`${t.label}: project ${t.projectHours}h`}</title>
                </rect>
                <rect
                  x={x}
                  y={baseY - projectH - supportH}
                  width={barWidth}
                  height={supportH}
                  className="fill-chart-2"
                  rx="2"
                >
                  <title>{`${t.label}: support ${t.supportHours}h`}</title>
                </rect>
                <text
                  x={x + barWidth / 2}
                  y={height - padding.bottom + 18}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono"
                  fontSize="11"
                >
                  {t.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="sr-only">{summaryText}</figcaption>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-chart-1" /> Project investment
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-chart-2" /> Sustaining operations
        </span>
      </div>
    </figure>
  );
}
