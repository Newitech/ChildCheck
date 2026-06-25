import { NextResponse } from "next/server";

import { buildCsv, csvResponseHeaders } from "@/lib/csv";
import { requireReportsUser } from "@/lib/reports-shared";
import { visitorsReport } from "@/lib/report-queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/visitors
 *   ?dateFrom=&dateTo=&format=(json|csv)
 *
 * First-time / visitor follow-up report. Lists every Person flagged
 * isVisitor=true, their first recorded check-in date, total visits in range,
 * and whether they returned (>=2 check-ins total — across all time).
 *
 * JSON returns: { rows: [{ personId, name, firstVisitDate, visitCount, returned }] }
 */
export async function GET(req: Request) {
  const auth = await requireReportsUser();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const format = url.searchParams.get("format")?.trim() || "json";

  const result = await visitorsReport({
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
  });

  if (format === "csv") {
    const header = ["Name", "FirstVisitDate", "VisitCount", "Returned"];
    const csvRows = result.rows.map((r) => [
      r.name,
      r.firstVisitDate ?? "",
      r.visitCount,
      r.returned ? "Yes" : "No",
    ]);
    const csv = buildCsv(header, csvRows);
    const fromTag = result.dateFrom.replace(/-/g, "");
    const toTag = result.dateTo.replace(/-/g, "");
    return new NextResponse(csv, {
      status: 200,
      headers: csvResponseHeaders(`visitors-${fromTag}-${toTag}.csv`),
    });
  }

  return NextResponse.json({ rows: result.rows });
}
