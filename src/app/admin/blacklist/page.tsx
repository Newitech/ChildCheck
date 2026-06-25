import Link from "next/link";
import { ArrowLeft, Ban } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { BlacklistTable } from "./blacklist-table";

export const dynamic = "force-dynamic";

/**
 * /admin/blacklist — consolidated view of all BlacklistEntry rows.
 *
 * Useful for the Security role: a single filterable list of everyone blocked
 * from collecting children in this organisation. Requires view_people.
 */
export default async function BlacklistPage() {
  await requirePermission("view_people");

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
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to admin
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <Ban className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Blacklist</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Everyone blocked or flagged from collecting children. Filter by
              family, child, or severity.
            </p>
          </div>
        </div>
      </div>

      <BlacklistTable />
    </div>
  );
}
