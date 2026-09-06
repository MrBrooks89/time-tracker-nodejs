import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { reminderLog as reminderLogTable } from "@/db/schema";
import { csvEscape } from "@/lib/reports";
import { reminderHistoryQuery } from "@/lib/reminders";
import { getSessionUser } from "@/lib/session";

// TS-020: reminder records export (CSV). The rows come from the exact same
// query the reminders page history table uses (reminderHistoryQuery), so the
// file can never diverge from what the admin sees. Full history is exported —
// capped defensively so a runaway log cannot produce a multi-GB response.

const EXPORT_ROW_LIMIT = 10_000;

interface HistoryCsvRow {
  id: string;
  userName: string;
  userEmail: string;
  weekStartDate: string;
  remindedByName: string;
  remindedAt: Date;
  note: string | null;
}

function toCsv(rows: HistoryCsvRow[]): string {
  const headers = [
    "partner",
    "email",
    "week_start",
    "reminded_by",
    "reminded_at",
    "note",
  ];
  const lines = rows.map((row) =>
    [
      row.userName,
      row.userEmail,
      row.weekStartDate,
      row.remindedByName,
      row.remindedAt.toISOString(),
      row.note ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\r\n");
}

export async function GET() {
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

  const rows: HistoryCsvRow[] = await reminderHistoryQuery()
    .orderBy(desc(reminderLogTable.remindedAt))
    .limit(EXPORT_ROW_LIMIT);

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // e.g. reminders-20260906.csv
      "Content-Disposition": `attachment; filename="reminders-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.csv"`,
    },
  });
}
