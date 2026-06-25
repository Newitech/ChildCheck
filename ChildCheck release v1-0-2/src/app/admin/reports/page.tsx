import Link from "next/link";
import { ArrowLeft, BarChart3 } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFeatureFlags } from "@/lib/feature-flags";
import { Button } from "@/components/ui/button";
import { ReportsDashboard } from "./reports-dashboard";

export const dynamic = "force-dynamic";

/**
 * /admin/reports — Stage 10 Reporting & Analytics.
 *
 * Access: Admin / PeopleManager / Security (the admin-side triad from the
 * layout's role gate). We still call requireRole here so a deep-link from a
 * logged-out session redirects to /login.
 *
 * The server shell loads the filter dropdown options (programs, classes,
 * rooms) and the WWCC flag so the client component can render without a
 * loading flash.
 */
export default async function ReportsPage() {
  await requireRole("Admin", "PeopleManager", "Security");

  const [programs, classes, rooms, flags] = await Promise.all([
    db.program.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.groupClass.findMany({
      where: { isActive: true, program: { isActive: true } },
      select: {
        id: true,
        name: true,
        programId: true,
        program: { select: { name: true } },
      },
      orderBy: [{ program: { name: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    db.room.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    getFeatureFlags(),
  ]);

  const scopeOptions = {
    programs: programs.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    classes: classes.map((c) => ({
      id: c.id,
      name: c.name,
      programId: c.programId,
      programName: c.program.name,
    })),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, code: r.code })),
  };

  return (
    <div className="space-y-6">
      <div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2 text-muted-foreground"
        >
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Admin home
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Attendance, headcount trends, volunteer hours, visitor follow-up &amp;
              WWCC expiry. Export to CSV, print or email.
            </p>
          </div>
        </div>
      </div>

      <ReportsDashboard
        scopeOptions={scopeOptions}
        wwccTrackingEnabled={flags.working_with_children_tracking}
      />
    </div>
  );
}
