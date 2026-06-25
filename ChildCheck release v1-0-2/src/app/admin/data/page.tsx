import Link from "next/link";
import { ArrowLeft, ArrowUpDown } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { DataConsole } from "./data-console";

export const dynamic = "force-dynamic";

/**
 * /admin/data — Stage 12 Import / Export admin page.
 *
 * Two tabs:
 *   1. Export — buttons to export People / Families / Attendance / Audit as
 *      CSV. Date range pickers for attendance + audit.
 *   2. Import — download templates (People / Families), upload a CSV,
 *      dry-run (preview) before committing, atomic real import.
 *
 * Requires Admin or PeopleManager (manage_people).
 */
export default async function DataPage() {
  await requirePermission("manage_people");

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
            <ArrowUpDown className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Import / Export</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Bulk-import people and families from CSV (with a mandatory
              dry-run preview), or export any list as a CSV backup.
            </p>
          </div>
        </div>
      </div>

      <DataConsole />
    </div>
  );
}
