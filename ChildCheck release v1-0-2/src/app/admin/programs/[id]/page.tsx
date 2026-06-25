import Link from "next/link";
import { ArrowLeft, CalendarRange } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ProgramDetail } from "./program-detail";

export const dynamic = "force-dynamic";

/**
 * /admin/programs/[id] — program detail with classes.
 *
 * Shows program header + the classes section (table with name, age range,
 * grade, room assignment, schedule summary, edit/delete). Each class row lets
 * the admin assign a room via a select.
 */
export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("view_programs");
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/admin/programs">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Programs
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarRange className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Program detail</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage the classes, room assignments and schedules for this program.
            </p>
          </div>
        </div>
      </div>

      <ProgramDetail programId={id} />
    </div>
  );
}
