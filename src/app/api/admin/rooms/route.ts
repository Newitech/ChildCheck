import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  code: z.string().trim().max(10).optional().nullable(),
  building: z.string().trim().max(120).optional().nullable(),
  capacity: z.number().int().min(0).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/**
 * GET /api/admin/rooms — list rooms.
 *
 * Query: includeInactive=true includes soft-deleted rooms.
 * Each room includes a count of active classes currently assigned to it.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("includeInactive") === "true";

  const rooms = await db.room.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ building: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: { classes: { where: { isActive: true } } },
      },
    },
  });

  return NextResponse.json({
    items: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      building: r.building,
      capacity: r.capacity,
      notes: r.notes,
      isActive: r.isActive,
      classCount: r._count.classes,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

/**
 * POST /api/admin/rooms — create a room.
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

  const created = await db.room.create({
    data: {
      name: p.name,
      code: p.code ?? null,
      building: p.building ?? null,
      capacity: p.capacity ?? null,
      notes: p.notes ?? null,
      isActive: true,
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "room.add",
    entity: "Room",
    entityId: created.id,
    details: { name: created.name, code: created.code, building: created.building, capacity: created.capacity },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
