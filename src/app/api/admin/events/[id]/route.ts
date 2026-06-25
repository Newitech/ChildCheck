import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  date: z.string().datetime().optional(),
  endDate: z.string().datetime().optional().nullable(),
  location: z.string().trim().max(200).optional().nullable(),
  programId: z.string().min(1).max(60).optional().nullable(),
  roomIds: z.array(z.string().min(1).max(60)).optional(),
  classIds: z.array(z.string().min(1).max(60)).optional(),
  isActive: z.boolean().optional(),
}).refine(
  (d) => {
    if (d.date && d.endDate) return new Date(d.endDate) >= new Date(d.date);
    return true;
  },
  { message: "endDate must be on or after date", path: ["endDate"] },
);

/**
 * GET /api/admin/events/[id] — event detail with associated rooms + classes.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const ev = await db.event.findUnique({
    where: { id },
    include: {
      program: { select: { id: true, name: true, slug: true } },
      rooms: {
        include: {
          room: {
            select: { id: true, name: true, code: true, building: true, capacity: true },
          },
        },
      },
      classes: {
        include: {
          class: {
            select: {
              id: true,
              name: true,
              slug: true,
              ageMin: true,
              ageMax: true,
              gradeLevel: true,
              program: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
    },
  });
  if (!ev) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: ev.id,
    name: ev.name,
    description: ev.description,
    date: ev.date.toISOString(),
    endDate: ev.endDate ? ev.endDate.toISOString() : null,
    location: ev.location,
    program: ev.program,
    isActive: ev.isActive,
    rooms: ev.rooms.map((er) => er.room),
    classes: ev.classes.map((ec) => ec.class),
    createdAt: ev.createdAt.toISOString(),
    updatedAt: ev.updatedAt.toISOString(),
  });
}

/**
 * PUT /api/admin/events/[id] — update an event.
 *
 * When `roomIds` is supplied, the event's room associations are fully replaced
 * (any existing room not in the new list is removed; new ones are added).
 * Same for `classIds`. When omitted, existing associations are preserved.
 *
 * Requires manage_programs permission.
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const existing = await db.event.findUnique({
    where: { id },
    select: { id: true, name: true, date: true, endDate: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
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

  // Validate rooms if provided.
  if (p.roomIds) {
    const rooms = await db.room.findMany({
      where: { id: { in: p.roomIds } },
      select: { id: true, isActive: true },
    });
    const bad = p.roomIds.filter(
      (rid) => !rooms.find((r) => r.id === rid && r.isActive),
    );
    if (bad.length > 0) {
      return NextResponse.json(
        { error: `room not found or inactive: ${bad.join(", ")}` },
        { status: 400 },
      );
    }
  }

  // Validate classes if provided.
  if (p.classIds) {
    const classes = await db.groupClass.findMany({
      where: { id: { in: p.classIds } },
      select: { id: true, isActive: true },
    });
    const bad = p.classIds.filter(
      (cid) => !classes.find((c) => c.id === cid && c.isActive),
    );
    if (bad.length > 0) {
      return NextResponse.json(
        { error: `class not found or inactive: ${bad.join(", ")}` },
        { status: 400 },
      );
    }
  }

  // end-date / date precedence check after merge with existing values.
  const newDate = p.date ? new Date(p.date) : existing.date;
  const newEndDate = p.endDate !== undefined
    ? p.endDate ? new Date(p.endDate) : null
    : existing.endDate;
  if (newEndDate && newEndDate < newDate) {
    return NextResponse.json(
      { error: "endDate must be on or after date" },
      { status: 400 },
    );
  }

  await db.$transaction(async (tx) => {
    await tx.event.update({
      where: { id },
      data: {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.date !== undefined ? { date: new Date(p.date) } : {}),
        ...(p.endDate !== undefined
          ? { endDate: p.endDate ? new Date(p.endDate) : null }
          : {}),
        ...(p.location !== undefined ? { location: p.location } : {}),
        ...(p.programId !== undefined ? { programId: p.programId } : {}),
        ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
      },
    });

    if (p.roomIds) {
      await tx.eventRoom.deleteMany({ where: { eventId: id } });
      if (p.roomIds.length > 0) {
        await tx.eventRoom.createMany({
          data: p.roomIds.map((rid) => ({ eventId: id, roomId: rid })),
        });
      }
    }
    if (p.classIds) {
      await tx.eventClass.deleteMany({ where: { eventId: id } });
      if (p.classIds.length > 0) {
        await tx.eventClass.createMany({
          data: p.classIds.map((cid) => ({ eventId: id, classId: cid })),
        });
      }
    }
  });

  await logAudit({
    actorUserId: user.id,
    action: "event.update",
    entity: "Event",
    entityId: id,
    details: {
      changes: p,
    },
  });

  return NextResponse.json({ id });
}

/**
 * DELETE /api/admin/events/[id] — soft-delete an event.
 * Requires manage_programs permission.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const existing = await db.event.findUnique({
    where: { id },
    select: { id: true, name: true, date: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.event.update({
    where: { id },
    data: { isActive: false },
  });

  await logAudit({
    actorUserId: user.id,
    action: "event.remove",
    entity: "Event",
    entityId: id,
    details: { name: existing.name, date: existing.date.toISOString() },
  });

  return NextResponse.json({ ok: true });
}
