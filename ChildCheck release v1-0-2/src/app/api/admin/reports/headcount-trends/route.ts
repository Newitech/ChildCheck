import { NextResponse } from "next/server";

import { buildCsv, csvResponseHeaders } from "@/lib/csv";
import { requireReportsUser } from "@/lib/reports-shared";
import { headcountTrendsReport } from "@/lib/report-queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/headcount-trends
 *   ?roomId=&classId=&dateFrom=&dateTo=&format=(json|csv)
 *
 * Compares manually-reported HeadcountLog entries to the system's count of
 * checked-in children for the same scope + day.
 *
 * JSON returns: { rows: [...], chart: [{ date, reported, system }] }
 * CSV returns: text/csv.
 */
export async function GET(req: Request) {
  const auth = await requireReportsUser();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const roomId = url.searchParams.get("roomId")?.trim() || null;
  const classId = url.searchParams.get("classId")?.trim() || null;
  const format = url.searchParams.get("format")?.trim() || "json";

  if (!roomId && !classId) {
    return NextResponse.json(
      { error: "Either roomId or classId must be provided" },
      { status: 400 },
    );
  }

  const result = await headcountTrendsReport({
    roomId,
    classId,
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
  });

  if (format === "csv") {
    const header = ["Date", "Reported", "System", "Discrepancy"];
    const csvRows = result.rows.map((r) => [
      r.date,
      r.reported ?? "",
      r.system,
      r.discrepancy ?? "",
    ]);
    const csv = buildCsv(header, csvRows);
    const fromTag = result.dateFrom.replace(/-/g, "");
    const toTag = result.dateTo.replace(/-/g, "");
    return new NextResponse(csv, {
      status: 200,
      headers: csvResponseHeaders(`headcount-trends-${fromTag}-${toTag}.csv`),
    });
  }

  return NextResponse.json({ rows: result.rows, chart: result.chart });
}
