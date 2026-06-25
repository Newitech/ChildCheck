import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PrintersConsole } from "./printers-console";

export const dynamic = "force-dynamic";

/**
 * /admin/printers — Stage 11 printing subsystem admin page.
 *
 * Three tabs:
 *   1. Printers — CRUD list of printers (driver, queue, purpose, default).
 *   2. Room assignments — matrix of rooms × assigned printers (add/remove).
 *   3. Label templates — list + form-based editor with a live preview.
 *
 * Requires manage_programs (same permission as rooms/programs editing).
 */
export default async function PrintersPage() {
  await requirePermission("manage_programs");

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
            <Printer className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Printers</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Configure label &amp; slip printers, assign them to rooms, and
              edit the label template used at check-in.
            </p>
          </div>
        </div>
      </div>

      <PrintersConsole />
    </div>
  );
}
