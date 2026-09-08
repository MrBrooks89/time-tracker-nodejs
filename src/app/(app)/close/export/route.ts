import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import type { ExceptionRow } from "@/lib/close-report";
import { exceptionLabels, loadExceptionRows } from "@/lib/close-report";
import { csvEscape } from "@/lib/reports";
import { getSettings } from "@/lib/settings-db";
import { getSessionUser } from "@/lib/session";

// TS-025: pre-close exception report export. The rows come from the shared
// loadExceptionRows (close-report.ts) — the exact same query shape +
// exceptionFlags() call the close page and the close-initiation distribution
// use, so the exported list can never diverge from what the admin sees or
// what gets emailed at close initiation. Tolerance is the admin-configured
// setting (NF-012), not the config.ts default.

function roundHours(hours: number): number {
  return Math.round(hours * 4) / 4;
}

function toCsv(rows: ExceptionRow[]): string {
  const headers = [
    "partner",
    "email",
    "team",
    "week_start",
    "state",
    "exception_type",
    "actual_hours",
    "expected_hours",
  ];
  const lines = rows.map((row) =>
    [
      row.name,
      row.email,
      row.team ?? "",
      row.weekStartDate,
      row.state,
      row.flags.map((f) => exceptionLabels[f]).join("; "),
      String(roundHours(row.totalHours)),
      String(roundHours(row.expectedHours)),
    ]
      .map(csvEscape)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\r\n");
}

function toXlsxBuffer(rows: ExceptionRow[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    rows.map((row) => ({
      partner: row.name,
      email: row.email,
      team: row.team ?? "",
      week_start: row.weekStartDate,
      state: row.state,
      exception_type: row.flags.map((f) => exceptionLabels[f]).join("; "),
      actual_hours: roundHours(row.totalHours),
      expected_hours: roundHours(row.expectedHours),
    })),
  );
  XLSX.utils.book_append_sheet(wb, ws, "Exceptions");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function GET(request: Request) {
  const viewer = await getSessionUser();
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden — admin only." },
      { status: 403 },
    );
  }

  const params = new URL(request.url).searchParams;
  const fiscalYear = Number(params.get("year"));
  const periodNumber = Number(params.get("period"));
  const format = params.get("format") === "xlsx" ? "xlsx" : "csv";

  if (!Number.isInteger(fiscalYear) || !Number.isInteger(periodNumber)) {
    return NextResponse.json(
      { error: "Missing or invalid year/period parameters." },
      { status: 400 },
    );
  }

  const settings = await getSettings();
  const rows = await loadExceptionRows(
    fiscalYear,
    periodNumber,
    settings.hoursTolerance,
  );
  if (rows === null) {
    return NextResponse.json(
      { error: "Unknown or not-yet-completed fiscal period." },
      { status: 400 },
    );
  }

  // e.g. exceptions-fy2026-p03.csv
  const filename = `exceptions-fy${fiscalYear}-p${String(periodNumber).padStart(2, "0")}.${format}`;

  if (format === "xlsx") {
    const buffer = toXlsxBuffer(rows);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
