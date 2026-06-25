import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { EventsList } from "./events-list";

export const dynamic = "force-dynamic";

/**
 * /admin/events — Events (Stage 5).
 *
 * Lists upcoming events (one-off / occasional) with name, date, location,
 * program, room/class counts. Provides add / edit / delete dialogs.
 */
export default async function EventsPage() {
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
            <CalendarDays className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Events</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              One-off or occasional events — community fun days, holiday programs,
              special services.
            </p>
          </div>
        </div>
      </div>

      <EventsList />
    </div>
  );
}
