import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  date: z.string().datetime(),
  endDate: z.string().datetime().optional().nullable(),
  location: z.string().trim().max(200).optional().nullable(),
  programId: z.string().min(1).max(60).optional().nullable(),
  roomIds: z.array(z.string().min(1).max(60)).optional().default([]),
  classIds: z.array(z.string().min(1).max(60)).optional().default([]),
}).refine(
  (d) => {
    if (!d.endDate) return true;
    return new Date(d.endDate) >= new Date(d.date);
  },
  { message: "endDate must be on or after date", path: ["endDate"] },
);

/**
 * GET /api/admin/events — list events.
 *
 * Query params:
 *   - from: ISO date string (inclusive) — default: today
 *   - to:   ISO date string (inclusive)
 *   - includeInactive: "true" to include archived
 *   - upcoming: "true" — shortcut for "from = today" (default ordering upcoming first)
 *
 * Each event includes its program (if any) + counts of associated rooms/classes.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const upcoming = url.searchParams.get("upcoming");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const where: { isActive?: boolean; date?: { gte?: Date; lte?: Date } } = {};
  if (!includeInactive) where.isActive = true;

  if (upcoming === "true" && !fromParam) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    where.date = { gte: startOfToday };
  } else if (fromParam || toParam) {
    where.date = {};
    if (fromParam) where.date.gte = new Date(fromParam);
    if (toParam) where.date.lte = new Date(toParam);
  }

  const events = await db.event.findMany({
    where,
    orderBy: [{ date: "asc" }, { name: "asc" }],
    include: {
      program: { select: { id: true, name: true, slug: true } },
      _count: { select: { rooms: true, classes: true } },
    },
  });

  return NextResponse.json({
    items: events.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      date: e.date.toISOString(),
      endDate: e.endDate ? e.endDate.toISOString() : null,
      location: e.location,
      program: e.program,
      isActive: e.isActive,
      roomCount: e._count.rooms,
      classCount: e._count.classes,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    })),
  });
}

/**
 * POST /api/admin/events — create an event.
 *
 * Optionally associates rooms + classes via the EventRoom / EventClass join
 * tables. programId is optional (an event can be standalone). Validates that
 * each room/class id exists.
 *
 * Requires manage_programs permission.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  // Validate program if provided.
  if (p.programId) {
    const prog = await db.program.findUnique({
      where: { id: p.programId },
      select: { id: true, isActive: true },
    });
    if (!prog || !prog.isActive) {
      return NextResponse.json(
        { error: "programId not found or inactive" },
        { status: 400 },
      );
    }
  }

  // Validate rooms.
  if (p.roomIds.length > 0) {
    const rooms = await db.room.findMany({
      where: { id: { in: p.roomIds } },
      select: { id: true, isActive: true },
    });
    const missingOrInactive = p.roomIds.filter(
      (rid) => !rooms.find((r) => r.id === rid && r.isActive),
    );
    if (missingOrInactive.length > 0) {
      return NextResponse.json(
        { error: `room not found or inactive: ${missingOrInactive.join(", ")}` },
        { status: 400 },
      );
    }
  }

  // Validate classes.
  if (p.classIds.length > 0) {
    const classes = await db.groupClass.findMany({
      where: { id: { in: p.classIds } },
      select: { id: true, isActive: true },
    });
    const missingOrInactive = p.classIds.filter(
      (cid) => !classes.find((c) => c.id === cid && c.isActive),
    );
    if (missingOrInactive.length > 0) {
      return NextResponse.json(
        { error: `class not found or inactive: ${missingOrInactive.join(", ")}` },
        { status: 400 },
      );
    }
  }

  const created = await db.$transaction(async (tx) => {
    const ev = await tx.event.create({
      data: {
        name: p.name,
        description: p.description ?? null,
        date: new Date(p.date),
        endDate: p.endDate ? new Date(p.endDate) : null,
        location: p.location ?? null,
        programId: p.programId ?? null,
        isActive: true,
      },
    });

    if (p.roomIds.length > 0) {
      await tx.eventRoom.createMany({
        data: p.roomIds.map((rid) => ({ eventId: ev.id, roomId: rid })),
      });
    }
    if (p.classIds.length > 0) {
      await tx.eventClass.createMany({
        data: p.classIds.map((cid) => ({ eventId: ev.id, classId: cid })),
      });
    }
    return ev;
  });

  await logAudit({
    actorUserId: user.id,
    action: "event.add",
    entity: "Event",
    entityId: created.id,
    details: {
      name: created.name,
      date: created.date.toISOString(),
      programId: created.programId,
      roomIds: p.roomIds,
      classIds: p.classIds,
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
