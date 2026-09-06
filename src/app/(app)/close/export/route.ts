import { asc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { db } from "@/db";
import {
  holiday as holidayTable,
  timeEntry as timeEntryTable,
  timesheet as timesheetTable,
  user as userTable,
} from "@/db/schema";
import {
  exceptionFlags,
  weeksOfPeriod,
  type CloseSheetState,
  type ExceptionFlag,
} from "@/lib/close";
import { HOURS_TOLERANCE } from "@/lib/config";
import { FISCAL_PERIODS } from "@/lib/fiscal";
import { expectedHours } from "@/lib/holidays";
import { csvEscape } from "@/lib/reports";
import { getSessionUser } from "@/lib/session";

// TS-025: pre-close exception report export. The rows are computed with the
// exact same query shape + exceptionFlags() call as the close page's
// loadCloseData, so the exported list can never diverge from what the admin
// sees in the exception table.

interface ExceptionExportRow {
  name: string;
  email: string;
  team: string | null;
  weekStartDate: string;
  state: CloseSheetState;
  totalHours: number;
  expectedHours: number;
  flags: ExceptionFlag[];
}

const exceptionLabels: Record<ExceptionFlag, string> = {
  unsubmitted: "unsubmitted",
  hours_outlier: "hours_outlier",
};

function roundHours(hours: number): number {
  return Math.round(hours * 4) / 4;
}

async function loadExceptionRows(
  fiscalYear: number,
  periodNumber: number,
): Promise<ExceptionExportRow[] | null> {
  const period = FISCAL_PERIODS.find(
    (p) =>
      p.fiscalYear === fiscalYear && p.periodNumber === periodNumber,
  );
  if (!period) return null;

  // Only completed periods are closeable — same eligibility as the close page.
  const today = new Date().toISOString().slice(0, 10);
  if (period.endDate >= today) return null;

  const weeks = weeksOfPeriod(period);

  const [holidayDates, users, sheets] = await Promise.all([
    db
      .select({ date: holidayTable.observedDate })
      .from(holidayTable)
      .then((rows) => rows.map((h) => h.date)),
    db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        team: userTable.team,
        standardWeeklyHours: userTable.standardWeeklyHours,
      })
      .from(userTable)
      .where(eq(userTable.isActive, true))
      .orderBy(asc(userTable.name)),
    db
      .select({
        userId: timesheetTable.userId,
        weekStartDate: timesheetTable.weekStartDate,
        state: timesheetTable.state,
        totalHours: sql<number>`coalesce(sum(${timeEntryTable.hours}), 0)`,
      })
      .from(timesheetTable)
      .leftJoin(
        timeEntryTable,
        eq(timeEntryTable.timesheetId, timesheetTable.id),
      )
      .where(inArray(timesheetTable.weekStartDate, weeks))
      .groupBy(timesheetTable.id),
  ]);

  const sheetByUserWeek = new Map(
    sheets.map((s) => [`${s.userId}|${s.weekStartDate}`, s]),
  );

  const rows: ExceptionExportRow[] = [];
  for (const user of users) {
    for (const week of weeks) {
      const sheet = sheetByUserWeek.get(`${user.id}|${week}`);
      const state: CloseSheetState = sheet?.state ?? "not_started";
      const totalHours = sheet ? Number(sheet.totalHours ?? 0) : 0;
      const expected = expectedHours(
        week,
        user.standardWeeklyHours,
        holidayDates,
      );
      const { flags } = exceptionFlags(
        { userId: user.id, state, totalHours, expectedHours: expected },
        HOURS_TOLERANCE,
      );
      if (flags.length === 0) continue;
      rows.push({
        name: user.name,
        email: user.email,
        team: user.team,
        weekStartDate: week,
        state,
        totalHours,
        expectedHours: expected,
        flags,
      });
    }
  }
  return rows;
}

function toCsv(rows: ExceptionExportRow[]): string {
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

function toXlsxBuffer(rows: ExceptionExportRow[]): Buffer {
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

  const rows = await loadExceptionRows(fiscalYear, periodNumber);
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
