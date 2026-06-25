import Link from "next/link";
import { ArrowLeft, Users2 } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { FamiliesList } from "./families-list";

export const dynamic = "force-dynamic";

/**
 * /admin/families — Families list (Stage 3).
 */
export default async function FamiliesPage() {
  await requirePermission("view_people");

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
            <Users2 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Families</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Households — primary carers, children, emergency contacts.
            </p>
          </div>
        </div>
      </div>

      <FamiliesList />
    </div>
  );
}
