import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  code: z.string().trim().max(10).optional().nullable(),
  building: z.string().trim().max(120).optional().nullable(),
  capacity: z.number().int().min(0).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/admin/rooms/[id] — fetch a single room.
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
  const room = await db.room.findUnique({
    where: { id },
    include: {
      classes: {
        where: { isActive: true },
        include: { program: { select: { id: true, name: true, slug: true } } },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!room) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: room.id,
    name: room.name,
    code: room.code,
    building: room.building,
    capacity: room.capacity,
    notes: room.notes,
    isActive: room.isActive,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
    classes: room.classes.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      program: c.program,
    })),
  });
}

/**
 * PUT /api/admin/rooms/[id] — update a room.
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

  const existing = await db.room.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updated = await db.room.update({
    where: { id },
    data: {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.code !== undefined ? { code: p.code } : {}),
      ...(p.building !== undefined ? { building: p.building } : {}),
      ...(p.capacity !== undefined ? { capacity: p.capacity } : {}),
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
      ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "room.update",
    entity: "Room",
    entityId: id,
    details: p,
  });

  return NextResponse.json({ id: updated.id });
}

/**
 * DELETE /api/admin/rooms/[id] — soft-delete a room (isActive=false).
 * Classes referencing this room are auto-null'd via SetNull in the schema.
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

  const existing = await db.room.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.room.update({
    where: { id },
    data: { isActive: false },
  });

  await logAudit({
    actorUserId: user.id,
    action: "room.remove",
    entity: "Room",
    entityId: id,
    details: { name: existing.name },
  });

  return NextResponse.json({ ok: true });
}
