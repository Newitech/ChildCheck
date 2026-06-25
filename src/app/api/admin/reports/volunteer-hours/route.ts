import { NextResponse } from "next/server";

import { buildCsv, csvResponseHeaders } from "@/lib/csv";
import { requireReportsUser } from "@/lib/reports-shared";
import { volunteerHoursReport } from "@/lib/report-queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/volunteer-hours
 *   ?dateFrom=&dateTo=&format=(json|csv)
 *
 * For every User with role Volunteer or Teacher, sums the duration of every
 * CheckInRecord where they were either the checkedInByUserId OR the
 * checkedOutByUserId, grouped by user.
 *
 * JSON returns: { rows: [{ userId, name, role, sessions, totalMinutes }] }
 */
export async function GET(req: Request) {
  const auth = await requireReportsUser();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const format = url.searchParams.get("format")?.trim() || "json";

  const result = await volunteerHoursReport({
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
  });

  if (format === "csv") {
    const header = ["Volunteer", "Roles", "Sessions", "TotalMinutes"];
    const csvRows = result.rows.map((r) => [r.name, r.role, r.sessions, r.totalMinutes]);
    const csv = buildCsv(header, csvRows);
    const fromTag = result.dateFrom.replace(/-/g, "");
    const toTag = result.dateTo.replace(/-/g, "");
    return new NextResponse(csv, {
      status: 200,
      headers: csvResponseHeaders(`volunteer-hours-${fromTag}-${toTag}.csv`),
    });
  }

  return NextResponse.json({ rows: result.rows });
}
