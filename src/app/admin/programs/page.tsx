import Link from "next/link";
import { ArrowLeft, CalendarRange } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ProgramsList } from "./programs-list";

export const dynamic = "force-dynamic";

/**
 * /admin/programs — Programs & Classes (Stage 5).
 *
 * Lists every program (default + custom) as a card with name, class count,
 * default badge, and active toggle. Provides an "Add program" button + a
 * "Seed default programs" button that re-runs the idempotent seeding.
 */
export default async function ProgramsPage() {
  await requirePermission("view_programs");

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Admin home
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarRange className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Programs &amp; Classes</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage programs, classes, rooms, schedules, and one-off events.
            </p>
          </div>
        </div>
      </div>

      <ProgramsList />
    </div>
  );
}
