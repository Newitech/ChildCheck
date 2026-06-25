import { NextResponse } from "next/server";

import { buildCsv, csvResponseHeaders } from "@/lib/csv";
import { requireReportsUser } from "@/lib/reports-shared";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { wwccExpiryReport } from "@/lib/report-queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/wwcc-expiry
 *   ?withinDays=90&format=(json|csv)
 *
 * Lists every WorkingWithChildrenCard with status + expiry, sorted by
 * soonest-expiring. Flags expired (red) + expiring within 30/60/90 days.
 *
 * Returns 404 if the `working_with_children_tracking` feature flag is OFF.
 *
 * JSON returns: { rows: [{ personId, name, cardType, status, expiresAt,
 *                           daysUntilExpiry, flag }] }
 */
export async function GET(req: Request) {
  const auth = await requireReportsUser();
  if (!auth.ok) return auth.response;

  const wwccOn = await isFeatureEnabled("working_with_children_tracking");
  if (!wwccOn) {
    return NextResponse.json(
      { error: "Working-with-Children tracking is disabled" },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format")?.trim() || "json";
  const withinDaysRaw = Number.parseInt(url.searchParams.get("withinDays") ?? "90", 10);
  const withinDays = Number.isFinite(withinDaysRaw) ? withinDaysRaw : 90;

  const result = await wwccExpiryReport({ withinDays });

  if (format === "csv") {
    const header = ["Name", "CardType", "Status", "ExpiresAt", "DaysUntilExpiry", "Flag"];
    const csvRows = result.rows.map((r) => [
      r.name,
      r.cardType,
      r.status,
      r.expiresAt ?? "",
      r.daysUntilExpiry ?? "",
      r.flag,
    ]);
    const csv = buildCsv(header, csvRows);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return new NextResponse(csv, {
      status: 200,
      headers: csvResponseHeaders(`wwcc-expiry-${stamp}.csv`),
    });
  }

  return NextResponse.json({ rows: result.rows });
}
