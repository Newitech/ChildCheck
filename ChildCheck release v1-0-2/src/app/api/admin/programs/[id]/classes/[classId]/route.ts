import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  ageMin: z.number().int().min(0).max(130).optional().nullable(),
  ageMax: z.number().int().min(0).max(130).optional().nullable(),
  gradeLevel: z.string().trim().max(60).optional().nullable(),
  roomId: z.string().min(1).max(60).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/**
 * PUT /api/admin/programs/[id]/classes/[classId] — update a class.
 *
 * Supports assigning / reassigning / clearing the room (roomId: null clears it).
 * Validates the room exists and is active when a roomId is supplied.
 * Validates ageMax >= ageMin when both are provided.
 *
 * Requires manage_programs permission.
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; classId: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, classId } = await ctx.params;

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

  const existing = await db.groupClass.findUnique({
    where: { id: classId },
    select: { id: true, programId: true, name: true, slug: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "class not found" }, { status: 404 });
  }
  if (existing.programId !== id) {
    return NextResponse.json(
      { error: "class does not belong to this program" },
      { status: 400 },
    );
  }

  // Validate room if provided (and not null).
  if (p.roomId) {
    const room = await db.room.findUnique({
      where: { id: p.roomId },
      select: { id: true, isActive: true },
    });
    if (!room || !room.isActive) {
      return NextResponse.json(
        { error: "roomId not found or inactive" },
        { status: 400 },
      );
    }
  }

  // ageMax must be >= ageMin when both set.
  if (
    p.ageMin !== null &&
    p.ageMin !== undefined &&
    p.ageMax !== null &&
    p.ageMax !== undefined &&
    p.ageMax < p.ageMin
  ) {
    return NextResponse.json(
      { error: "ageMax must be ≥ ageMin" },
      { status: 400 },
    );
  }

  const updated = await db.groupClass.update({
    where: { id: classId },
    data: {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.description !== undefined ? { description: p.description } : {}),
      ...(p.ageMin !== undefined ? { ageMin: p.ageMin } : {}),
      ...(p.ageMax !== undefined ? { ageMax: p.ageMax } : {}),
      ...(p.gradeLevel !== undefined ? { gradeLevel: p.gradeLevel } : {}),
      ...(p.roomId !== undefined ? { roomId: p.roomId } : {}),
      ...(p.sortOrder !== undefined ? { sortOrder: p.sortOrder } : {}),
      ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "class.update",
    entity: "GroupClass",
    entityId: classId,
    details: { programId: id, slug: existing.slug, changes: p },
  });

  return NextResponse.json({ id: updated.id });
}

/**
 * DELETE /api/admin/programs/[id]/classes/[classId] — soft-delete a class.
 * Requires manage_programs permission.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; classId: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, classId } = await ctx.params;

  const existing = await db.groupClass.findUnique({
    where: { id: classId },
    select: { id: true, programId: true, name: true, slug: true, isDefault: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "class not found" }, { status: 404 });
  }
  if (existing.programId !== id) {
    return NextResponse.json(
      { error: "class does not belong to this program" },
      { status: 400 },
    );
  }

  await db.groupClass.update({
    where: { id: classId },
    data: { isActive: false },
  });

  await logAudit({
    actorUserId: user.id,
    action: "class.remove",
    entity: "GroupClass",
    entityId: classId,
    details: {
      programId: id,
      slug: existing.slug,
      name: existing.name,
      isDefault: existing.isDefault,
    },
  });

  return NextResponse.json({ ok: true });
}
