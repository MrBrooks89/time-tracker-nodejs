import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { canManagePeople } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";
import {
  csvEscape,
  getActualsReport,
  getClassificationReport,
  getComplianceReport,
  resolveScope,
} from "@/lib/reports";

type Sheet = { name: string; rows: Array<Record<string, string | number>> };

function toCsv(sheets: Sheet[]): string {
  const primary = sheets[0];
  if (!primary || primary.rows.length === 0) return "";
  const headers = Object.keys(primary.rows[0]);
  const lines = primary.rows.map((row) =>
    headers.map((h) => csvEscape(String(row[h] ?? ""))).join(","),
  );
  return [headers.join(","), ...lines].join("\r\n");
}

function toXlsxBuffer(sheets: Sheet[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const round = (v: number) => Math.round(v * 4) / 4;

export async function GET(request: Request) {
  const viewer = await getSessionUser();
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const params = url.searchParams;
  const format = params.get("format") === "xlsx" ? "xlsx" : "csv";
  const tab = params.get("tab") ?? "dashboard";

  const scopeData = resolveScope({
    week: params.get("week") ?? undefined,
    year: params.get("year") ?? undefined,
    period: params.get("period") ?? undefined,
    quarter: params.get("quarter") ?? undefined,
  });
  if (!scopeData) {
    return NextResponse.json({ error: "Unknown fiscal range" }, { status: 400 });
  }

  const canManage = canManagePeople(viewer.role);
  const filters = {
    team: canManage ? (params.get("team") ?? undefined) : undefined,
    managerId: canManage ? (params.get("managerId") ?? undefined) : undefined,
    projectId: params.get("projectId") ?? undefined,
    userId: canManage ? (params.get("userId") ?? undefined) : undefined,
    categoryId: params.get("categoryId") ?? undefined,
  };

  let sheets: Sheet[];
  let filenameTab = tab;

  if (tab === "actuals") {
    const report = await getActualsReport(viewer, scopeData.scope, scopeData.label, filters);
    filenameTab = "actuals";
    sheets = [
      {
        name: "Summary",
        rows: [
          { metric: "Scope", value: report.label },
          { metric: "From", value: report.from },
          { metric: "To", value: report.to },
          { metric: "Total hours", value: report.total },
          { metric: "CapEx hours", value: report.capex },
          { metric: "OpEx hours", value: report.opex },
          {
            metric: "Prior period",
            value: report.prior ? `${report.prior.label}: ${report.prior.total}h` : "none",
          },
        ],
      },
      {
        name: "By partner",
        rows: report.byPartner.map((r) => ({
          partner: r.label,
          entries: r.entries,
          hours: round(r.hours),
        })),
      },
      {
        name: "By project",
        rows: report.byProject.map((r) => ({
          project: r.label,
          entries: r.entries,
          hours: round(r.hours),
        })),
      },
      {
        name: "By category",
        rows: report.byCategory.map((r) => ({
          category: r.label,
          entries: r.entries,
          hours: round(r.hours),
        })),
      },
      {
        name: "Entries",
        rows: report.entries.map((e) => ({
          date: e.entryDate,
          partner: e.userName,
          team: e.team ?? "",
          project: e.projectName ?? "",
          task_code: e.taskCodeName ?? "",
          category: e.categoryName ?? "",
          hours: round(e.hours),
          classification: e.classification,
        })),
      },
    ];
  } else if (tab === "compliance") {
    const rows = await getComplianceReport(scopeData.scope);
    filenameTab = "compliance";
    sheets = [
      {
        name: "Compliance",
        rows: rows.map((r) => ({
          partner: r.name,
          team: r.team ?? "",
          week: r.weekStartDate,
          state: r.state,
          hours: round(r.totalHours),
          submitted_at: r.submittedAt ?? "",
        })),
      },
    ];
  } else if (tab === "classification") {
    const report = await getClassificationReport(viewer, scopeData.scope, filters);
    filenameTab = "classification";
    sheets = [
      {
        name: "Totals",
        rows: [
          { metric: "Scope", value: scopeData.label },
          { metric: "Total hours", value: report.total.hours },
          { metric: "CapEx hours", value: report.total.capex },
          { metric: "OpEx hours", value: report.total.opex },
        ],
      },
      {
        name: "By task code",
        rows: report.byTaskCode.map((r) => ({
          task_code: r.taskCodeName,
          hours: round(r.hours),
          capex: round(r.capex),
          opex: round(r.opex),
        })),
      },
      {
        name: "By project",
        rows: report.byProject.map((r) => ({
          project: r.projectName,
          task_code: r.taskCodeName,
          hours: round(r.hours),
          capex: round(r.capex),
          opex: round(r.opex),
        })),
      },
      {
        name: "Entries",
        rows: report.entries.map((e) => ({
          date: e.entryDate,
          partner: e.userName,
          project: e.projectName ?? "",
          task_code: e.taskCodeName ?? "",
          category: e.categoryName ?? "",
          hours: round(e.hours),
          classification: e.classification,
        })),
      },
    ];
  } else {
    return NextResponse.json(
      { error: "This report has no export — use Actuals, Compliance, or Classification." },
      { status: 400 },
    );
  }

  const filename = `time-report-${filenameTab}-${scopeData.label.replace(/[^\w-]+/g, "-").toLowerCase()}.${format}`;

  if (format === "xlsx") {
    const buffer = toXlsxBuffer(sheets);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const csv = toCsv(sheets);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
