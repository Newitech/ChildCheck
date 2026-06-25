import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DRIVER_VALUES = ["browser", "qz_tray", "thermal_raw"] as const;
const PURPOSE_VALUES = ["label", "slip", "both"] as const;

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  driver: z.enum(DRIVER_VALUES).optional(),
  queueName: z.string().trim().max(120).optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  purpose: z.enum(PURPOSE_VALUES).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/**
 * GET /api/admin/printers/[id] — single printer (with assigned rooms).
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
  const printer = await db.printer.findUnique({
    where: { id },
    include: {
      rooms: { include: { room: { select: { id: true, name: true, code: true, building: true } } } },
    },
  });
  if (!printer) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: printer.id,
    name: printer.name,
    driver: printer.driver,
    queueName: printer.queueName,
    isDefault: printer.isDefault,
    isActive: printer.isActive,
    purpose: printer.purpose,
    notes: printer.notes,
    rooms: printer.rooms.map((rp) => ({
      id: rp.id,
      roomId: rp.room.id,
      roomName: rp.room.name,
      roomCode: rp.room.code,
      building: rp.room.building,
    })),
    createdAt: printer.createdAt.toISOString(),
    updatedAt: printer.updatedAt.toISOString(),
  });
}

/**
 * PUT /api/admin/printers/[id] — update a printer.
 * Requires manage_programs.
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

  const existing = await db.printer.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (p.isDefault) {
    await db.printer.updateMany({
      where: { isDefault: true, NOT: { id } },
      data: { isDefault: false },
    });
  }

  const updated = await db.printer.update({
    where: { id },
    data: {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.driver !== undefined ? { driver: p.driver } : {}),
      ...(p.queueName !== undefined ? { queueName: p.queueName } : {}),
      ...(p.isDefault !== undefined ? { isDefault: p.isDefault } : {}),
      ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
      ...(p.purpose !== undefined ? { purpose: p.purpose } : {}),
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "printer.update",
    entity: "Printer",
    entityId: id,
    details: p,
  });

  return NextResponse.json({ id: updated.id });
}

/**
 * DELETE /api/admin/printers/[id] — soft-delete a printer (isActive=false).
 * Hard delete is reserved for admins via a separate path; soft-delete keeps
 * the audit trail intact and lets existing RoomPrinter links resolve.
 *
 * Requires manage_programs.
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

  const existing = await db.printer.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.printer.update({
    where: { id },
    data: { isActive: false, isDefault: false },
  });

  await logAudit({
    actorUserId: user.id,
    action: "printer.remove",
    entity: "Printer",
    entityId: id,
    details: { name: existing.name },
  });

  return NextResponse.json({ ok: true });
}
