import { NextResponse } from "next/server";

import { buildCsv, csvResponseHeaders } from "@/lib/csv";
import { requireReportsUser } from "@/lib/reports-shared";
import { attendanceReport } from "@/lib/report-queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/attendance
 *   ?programId=&classId=&dateFrom=&dateTo=&format=(json|csv)
 *
 * Attendance report grouped by date — counts of check-ins, check-outs, and
 * children still in care per calendar day, with optional program/class filters.
 *
 * JSON returns:
 *   { rows: [...], chart: [{ date, count }] }
 *
 * CSV returns: text/csv with one row per (date × program/class group).
 */
export async function GET(req: Request) {
  const auth = await requireReportsUser();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const format = url.searchParams.get("format")?.trim() || "json";

  const result = await attendanceReport({
    programId: url.searchParams.get("programId"),
    classId: url.searchParams.get("classId"),
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
  });

  if (format === "csv") {
    const header = ["Date", "Program", "Class", "CheckedIn", "CheckedOut", "StillInCare"];
    const csvRows = result.rows.map((r) => [
      r.date,
      r.programName ?? "",
      r.className ?? "",
      r.checkedIn,
      r.checkedOut,
      r.stillIn,
    ]);
    const csv = buildCsv(header, csvRows);
    const fromTag = result.dateFrom.replace(/-/g, "");
    const toTag = result.dateTo.replace(/-/g, "");
    return new NextResponse(csv, {
      status: 200,
      headers: csvResponseHeaders(`attendance-report-${fromTag}-${toTag}.csv`),
    });
  }

  return NextResponse.json({ rows: result.rows, chart: result.chart });
}
