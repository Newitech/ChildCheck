import Link from "next/link";
import { ArrowLeft, Plug } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ElvantoConsole } from "./elvanto-console";

export const dynamic = "force-dynamic";

/**
 * /admin/integrations/elvanto — Elvanto connector admin page.
 *
 * Three tabs:
 *   1. Import from Elvanto  — upload CSV or paste JSON, dry-run preview,
 *      atomic real import (idempotent matching by email / name+DOB).
 *   2. Export to Elvanto    — download an Elvanto-format CSV of every active
 *      person + their family memberships.
 *   3. Quick add one        — single-record form (maps + imports one
 *      person/family in one shot).
 *
 * Plus a "Field mapping reference" expandable section + a note about
 * address-field data minimisation.
 *
 * Requires manage_people permission (Admin / PeopleManager).
 */
export default async function ElvantoPage() {
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
            <Plug className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Elvanto connector
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Import people &amp; families from an Elvanto CSV / JSON export
              (with a mandatory dry-run preview), push them back to Elvanto as
              a CSV, or quick-add a single Elvanto record.
            </p>
          </div>
        </div>
      </div>

      <ElvantoConsole />
    </div>
  );
}
