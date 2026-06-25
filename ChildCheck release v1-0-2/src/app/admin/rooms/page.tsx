import Link from "next/link";
import { ArrowLeft, DoorOpen } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { RoomsList } from "./rooms-list";

export const dynamic = "force-dynamic";

/**
 * /admin/rooms — Rooms (Stage 5).
 *
 * Lists every room with name, code, building, capacity, active toggle.
 * Provides add / edit / delete dialogs.
 */
export default async function RoomsPage() {
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
            <DoorOpen className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Rooms</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage the physical rooms / areas where check-in / out happens.
            </p>
          </div>
        </div>
      </div>

      <RoomsList />
    </div>
  );
}
