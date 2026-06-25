import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PeopleList } from "./people-list";

export const dynamic = "force-dynamic";

/**
 * /admin/people — People & Families list (Stage 3).
 *
 * Lists every active Person with avatar + name + type + contact + family
 * count + WWCC summary. Search + filter + pagination + create/edit/delete
 * via the PeopleList client component.
 */
export default async function PeoplePage() {
  const user = await requirePermission("view_people");

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
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">People</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage adults, children, visitors and their family memberships.
            </p>
          </div>
        </div>
      </div>

      <PeopleList currentUserId={user.id} />
    </div>
  );
}
