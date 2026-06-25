import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getOrgConfig } from "@/lib/branding";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  attendanceReport,
  headcountTrendsReport,
  volunteerHoursReport,
  visitorsReport,
  wwccExpiryReport,
  type AttendanceRow,
  type HeadcountRow,
  type VolunteerHoursRow,
  type VisitorRow,
  type WwccRow,
} from "@/lib/report-queries";
import { PrintAuto } from "./print-auto";

export const dynamic = "force-dynamic";

/**
 * /admin/reports/print?type=...&<report params>
 *
 * Print-friendly HTML view of any report. Calls window.print() on mount via
 * the PrintAuto client component. Opens in a new tab from the dashboard
 * toolbar's "Print" button.
 */
type ReportType = "attendance" | "headcount-trends" | "volunteer-hours" | "visitors" | "wwcc-expiry";

function isReportType(s: string | null): s is ReportType {
  return (
    s === "attendance" ||
    s === "headcount-trends" ||
    s === "volunteer-hours" ||
    s === "visitors" ||
    s === "wwcc-expiry"
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("Admin", "PeopleManager", "Security");
  const config = await getOrgConfig();
  const sp = await searchParams;
  const getStr = (k: string): string | null => {
    const v = sp[k];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  };

  const type = getStr("type");
  if (!isReportType(type)) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Unknown report type.</p>
        <Link href="/admin/reports" className="text-primary underline">Back to reports</Link>
      </div>
    );
  }

  const titleMap: Record<ReportType, string> = {
    attendance: "Attendance report",
    "headcount-trends": "Headcount trends",
    "volunteer-hours": "Volunteer hours",
    visitors: "Visitor follow-up",
    "wwcc-expiry": "WWCC expiry",
  };
  const title = titleMap[type];

  let body: React.ReactNode;
  let range: { from: string; to: string } | null = null;

  if (type === "attendance") {
    const r = await attendanceReport({
      programId: getStr("programId"),
      classId: getStr("classId"),
      dateFrom: getStr("dateFrom"),
      dateTo: getStr("dateTo"),
    });
    range = { from: r.dateFrom, to: r.dateTo };
    body = (
      <PrintTable
        head={["Date", "Program", "Class", "In", "Out", "Still in care"]}
        rows={r.rows.map((x: AttendanceRow) => [
          x.date,
          x.programName ?? "—",
          x.className ?? "—",
          String(x.checkedIn),
          String(x.checkedOut),
          String(x.stillIn),
        ])}
      />
    );
  } else if (type === "headcount-trends") {
    const r = await headcountTrendsReport({
      roomId: getStr("roomId"),
      classId: getStr("classId"),
      dateFrom: getStr("dateFrom"),
      dateTo: getStr("dateTo"),
    });
    range = { from: r.dateFrom, to: r.dateTo };
    body = (
      <PrintTable
        head={["Date", "Reported", "System", "Discrepancy"]}
        rows={r.rows.map((x: HeadcountRow) => [
          x.date,
          x.reported == null ? "—" : String(x.reported),
          String(x.system),
          x.discrepancy == null ? "—" : String(x.discrepancy),
        ])}
      />
    );
  } else if (type === "volunteer-hours") {
    const r = await volunteerHoursReport({
      dateFrom: getStr("dateFrom"),
      dateTo: getStr("dateTo"),
    });
    range = { from: r.dateFrom, to: r.dateTo };
    body = (
      <PrintTable
        head={["Volunteer", "Roles", "Sessions", "Total time"]}
        rows={r.rows.map((x: VolunteerHoursRow) => [
          x.name,
          x.role,
          String(x.sessions),
          fmtMinutes(x.totalMinutes),
        ])}
      />
    );
  } else if (type === "visitors") {
    const r = await visitorsReport({
      dateFrom: getStr("dateFrom"),
      dateTo: getStr("dateTo"),
    });
    range = { from: r.dateFrom, to: r.dateTo };
    body = (
      <PrintTable
        head={["Name", "First visit", "Visits", "Returned"]}
        rows={r.rows.map((x: VisitorRow) => [
          x.name,
          x.firstVisitDate ?? "—",
          String(x.visitCount),
          x.returned ? "Yes" : "No",
        ])}
      />
    );
  } else {
    // wwcc-expiry
    const wwccOn = await isFeatureEnabled("working_with_children_tracking");
    if (!wwccOn) {
      body = (
        <p className="text-muted-foreground">
          Working-with-Children tracking is disabled.
        </p>
      );
    } else {
      const withinDaysRaw = Number.parseInt(getStr("withinDays") ?? "90", 10);
      const withinDays = Number.isFinite(withinDaysRaw) ? withinDaysRaw : 90;
      const r = await wwccExpiryReport({ withinDays });
      body = (
        <PrintTable
          head={["Name", "Card type", "Status", "Expires", "Days", "Flag"]}
          rows={r.rows.map((x: WwccRow) => [
            x.name,
            x.cardType,
            x.status,
            fmtDate(x.expiresAt),
            x.daysUntilExpiry == null ? "—" : String(x.daysUntilExpiry),
            x.flag,
          ])}
        />
      );
    }
  }

  const now = new Date();
  const generatedAt = now.toLocaleString();

  return (
    <div className="min-h-screen bg-white text-black p-8 print:p-0">
      <PrintAuto />
      <header className="mb-4 flex items-start justify-between gap-4 border-b border-black/20 pb-3 print:break-after-avoid">
        <div>
          <h1 className="text-xl font-bold">{config.branding.appName} — {title}</h1>
          {range && (
            <p className="text-sm text-black/70">
              Range: {range.from} → {range.to}
            </p>
          )}
        </div>
        <div className="text-right text-xs text-black/60">
          <div>Generated: {generatedAt}</div>
        </div>
      </header>
      <main>{body}</main>
      <footer className="mt-6 border-t border-black/20 pt-3 text-xs text-black/50 print:break-before-avoid">
        ChildCheck · Confidential — verify recipient before sharing.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print table helper
// ---------------------------------------------------------------------------

function PrintTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          {head.map((h) => (
            <th
              key={h}
              className="border border-black/30 px-2 py-1 text-left font-semibold bg-black/5"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td
              colSpan={head.length}
              className="border border-black/20 px-2 py-3 text-center text-black/60"
            >
              No rows.
            </td>
          </tr>
        )}
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className="border border-black/20 px-2 py-1 align-top">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
