import Link from "next/link";
import { ArrowLeft, UserCog } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { UsersList } from "./users-list";

export const dynamic = "force-dynamic";

/**
 * /admin/users — User & Role Management (Task URM).
 *
 * Admin-only. Lists every User (login account) with their Person name,
 * username, role badges, status, last login. Lets the admin edit roles,
 * reset passwords, set/clear PINs, and enable/disable accounts.
 */
export default async function UsersAdminPage() {
  const user = await requireRole("Admin");

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
            <UserCog className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Users &amp; Roles</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage login accounts, roles, passwords and PINs.
            </p>
          </div>
        </div>
      </div>

      <UsersList currentUserId={user.id} currentUsername={user.username} />
    </div>
  );
}
