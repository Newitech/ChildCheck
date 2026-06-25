import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getActiveProgramsForDate } from "@/lib/sessions";

export const dynamic = "force-dynamic";

/**
 * GET /api/volunteer/scope-options
 *
 * Returns the dropdown options for the volunteer dashboard's scope selector:
 *   - rooms: all active rooms
 *   - classes: all active classes (with program + room)
 *   - programs: all active programs
 *   - todayActive: programs active today (recurring + events) — used as the
 *     default scope suggestion
 *
 * Access: Teacher / Volunteer / Security / Admin (view_roster permission).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(user.roles, "view_roster")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [rooms, classes, programs, todayActive] = await Promise.all([
    db.room.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, building: true, capacity: true },
      orderBy: { name: "asc" },
    }),
    db.groupClass.findMany({
      where: { isActive: true, program: { isActive: true } },
      select: {
        id: true,
        name: true,
        slug: true,
        programId: true,
        program: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
        ageMin: true,
        ageMax: true,
      },
      orderBy: [{ program: { name: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    db.program.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true, color: true },
      orderBy: { sortOrder: "asc" },
    }),
    getActiveProgramsForDate(new Date()),
  ]);

  return NextResponse.json({
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      building: r.building,
      capacity: r.capacity,
    })),
    classes: classes.map((c) => ({
      id: c.id,
      name: c.name,
      programId: c.programId,
      programName: c.program.name,
      roomId: c.room?.id ?? null,
      roomName: c.room?.name ?? null,
      ageMin: c.ageMin,
      ageMax: c.ageMax,
    })),
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      color: p.color,
    })),
    todayActive,
  });
}
