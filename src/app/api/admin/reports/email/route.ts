import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { buildCsv } from "@/lib/csv";
import {
  attendanceReport,
  headcountTrendsReport,
  volunteerHoursReport,
  visitorsReport,
  wwccExpiryReport,
} from "@/lib/report-queries";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reportType: z.enum([
    "attendance",
    "headcount-trends",
    "volunteer-hours",
    "visitors",
    "wwcc-expiry",
  ]),
  to: z.string().trim().min(1).max(320),
  subject: z.string().trim().max(320).optional(),
  /** Always CSV for emailed reports (Excel-friendly, RFC-4180). */
  format: z.enum(["json", "csv"]).optional().default("csv"),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

/**
 * POST /api/admin/reports/email — email a generated report as a CSV attachment.
 *
 * Reuses the report query logic from src/lib/report-queries.ts so the emailed
 * CSV is byte-identical to what the in-app CSV download produces.
 *
 * Body:
 *   { reportType, to, subject?, params }
 *
 * If SMTP is not configured, returns 409 with `{ error: "smtp_not_configured" }`
 * — the UI uses this to show "Configure SMTP in Settings → Email first".
 *
 * Access: Admin / PeopleManager / Security.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const isAdminLike =
    user.roles.includes("Admin") ||
    user.roles.includes("PeopleManager") ||
    user.roles.includes("Security");
  if (!isAdminLike) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  // Coerce the params record into typed-string lookup (the dialog builds
  // params from URLSearchParams, so all values are strings).
  const str = (k: string): string | undefined => {
    const v = p.params?.[k];
    return typeof v === "string" ? v : v != null ? String(v) : undefined;
  };

  // Build the report. Each branch matches the corresponding GET report
  // endpoint so the CSV is identical to the in-app download.
  type Attachment = { filename: string; content: string };
  let attachment: Attachment;
  let humanTitle: string;

  try {
    switch (p.reportType) {
      case "attendance": {
        const r = await attendanceReport({
          programId: str("programId") ?? null,
          classId: str("classId") ?? null,
          dateFrom: str("dateFrom") ?? null,
          dateTo: str("dateTo") ?? null,
        });
        const header = ["Date", "Program", "Class", "CheckedIn", "CheckedOut", "StillInCare"];
        const rows = r.rows.map((row) => [
          row.date,
          row.programName ?? "",
          row.className ?? "",
          row.checkedIn,
          row.checkedOut,
          row.stillIn,
        ]);
        const fromTag = r.dateFrom.replace(/-/g, "");
        const toTag = r.dateTo.replace(/-/g, "");
        attachment = {
          filename: `attendance-report-${fromTag}-${toTag}.csv`,
          content: buildCsv(header, rows),
        };
        humanTitle = "Attendance report";
        break;
      }
      case "headcount-trends": {
        const r = await headcountTrendsReport({
          roomId: str("roomId") ?? null,
          classId: str("classId") ?? null,
          dateFrom: str("dateFrom") ?? null,
          dateTo: str("dateTo") ?? null,
        });
        const header = ["Date", "Reported", "System", "Discrepancy"];
        const rows = r.rows.map((row) => [
          row.date,
          row.reported ?? "",
          row.system,
          row.discrepancy ?? "",
        ]);
        const fromTag = r.dateFrom.replace(/-/g, "");
        const toTag = r.dateTo.replace(/-/g, "");
        attachment = {
          filename: `headcount-trends-${fromTag}-${toTag}.csv`,
          content: buildCsv(header, rows),
        };
        humanTitle = "Headcount trends report";
        break;
      }
      case "volunteer-hours": {
        const r = await volunteerHoursReport({
          dateFrom: str("dateFrom") ?? null,
          dateTo: str("dateTo") ?? null,
        });
        const header = ["Volunteer", "Roles", "Sessions", "TotalMinutes"];
        const rows = r.rows.map((row) => [row.name, row.role, row.sessions, row.totalMinutes]);
        const fromTag = r.dateFrom.replace(/-/g, "");
        const toTag = r.dateTo.replace(/-/g, "");
        attachment = {
          filename: `volunteer-hours-${fromTag}-${toTag}.csv`,
          content: buildCsv(header, rows),
        };
        humanTitle = "Volunteer hours report";
        break;
      }
      case "visitors": {
        const r = await visitorsReport({
          dateFrom: str("dateFrom") ?? null,
          dateTo: str("dateTo") ?? null,
        });
        const header = ["Name", "FirstVisitDate", "VisitCount", "Returned"];
        const rows = r.rows.map((row) => [
          row.name,
          row.firstVisitDate ?? "",
          row.visitCount,
          row.returned ? "Yes" : "No",
        ]);
        const fromTag = r.dateFrom.replace(/-/g, "");
        const toTag = r.dateTo.replace(/-/g, "");
        attachment = {
          filename: `visitors-${fromTag}-${toTag}.csv`,
          content: buildCsv(header, rows),
        };
        humanTitle = "Visitors report";
        break;
      }
      case "wwcc-expiry": {
        const wwccOn = await isFeatureEnabled("working_with_children_tracking");
        if (!wwccOn) {
          return NextResponse.json(
            { error: "Working-with-Children tracking is disabled" },
            { status: 404 },
          );
        }
        const withinRaw = parseInt(str("withinDays") ?? "90", 10);
        const withinDays = Number.isFinite(withinRaw) ? withinRaw : 90;
        const r = await wwccExpiryReport({ withinDays });
        const header = ["Name", "CardType", "Status", "ExpiresAt", "DaysUntilExpiry", "Flag"];
        const rows = r.rows.map((row) => [
          row.name,
          row.cardType,
          row.status,
          row.expiresAt ?? "",
          row.daysUntilExpiry ?? "",
          row.flag,
        ]);
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        attachment = {
          filename: `wwcc-expiry-${stamp}.csv`,
          content: buildCsv(header, rows),
        };
        humanTitle = "WWCC expiry report";
        break;
      }
    }
  } catch (err) {
    console.error("[reports.email] failed to build report:", err);
    return NextResponse.json(
      { error: "report_build_failed" },
      { status: 500 },
    );
  }

  // Build the email body — a small HTML summary + the CSV as an attachment.
  const subject = p.subject?.trim() || `${humanTitle} — ChildCheck`;
  const generatedAt = new Date().toLocaleString();
  const html =
    `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">` +
    `<h2 style="margin: 0 0 8px 0; color: #0f9d8a;">${escapeHtml(humanTitle)}</h2>` +
    `<p style="margin: 0 0 12px 0; color: #6b7280;">Generated ${escapeHtml(generatedAt)}</p>` +
    `<p>Please find the report attached as a CSV file.</p>` +
    `<p style="margin-top: 24px; font-size: 12px; color: #6b7280;">Sent by ChildCheck · report emailing is configured by your administrator.</p>` +
    `</div>`;
  const text = `${humanTitle}\nGenerated ${generatedAt}\n\nPlease find the report attached as a CSV file.\n\nSent by ChildCheck.`;

  const result = await sendEmail(
    {
      to: p.to,
      subject,
      html,
      text,
      attachments: [
        {
          filename: attachment.filename,
          content: attachment.content,
          contentType: "text/csv; charset=utf-8",
        },
      ],
    },
    { actorUserId: user.id },
  );

  if (!result.ok) {
    if (result.error === "smtp_not_configured") {
      return NextResponse.json(
        { error: "smtp_not_configured" },
        { status: 409 },
      );
    }
    await logAudit({
      actorUserId: user.id,
      action: "report.email_failed",
      entity: "Report",
      entityId: p.reportType,
      details: { to: p.to, error: result.error ?? "unknown" },
    });
    return NextResponse.json(
      { error: result.error ?? "send_failed" },
      { status: 502 },
    );
  }

  await logAudit({
    actorUserId: user.id,
    action: "report.email",
    entity: "Report",
    entityId: p.reportType,
    details: {
      to: p.to,
      subject,
      attachment: attachment.filename,
    },
  });

  return NextResponse.json({ ok: true, messageId: result.messageId });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
