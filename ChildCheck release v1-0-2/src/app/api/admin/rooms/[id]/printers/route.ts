import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const assignSchema = z.object({
  printerId: z.string().min(1),
});

/**
 * GET /api/admin/rooms/[id]/printers — list printers assigned to a room.
 *
 * Returns the printers explicitly linked via RoomPrinter. The caller can use
 * this list to display "assigned" badges in the room UI.
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
    select: { id: true, name: true },
  });
  if (!room) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const assignments = await db.roomPrinter.findMany({
    where: { roomId: id },
    include: {
      printer: { select: { id: true, name: true, driver: true, queueName: true, purpose: true, isDefault: true, isActive: true } },
    },
    orderBy: { printer: { isDefault: "desc" } },
  });

  return NextResponse.json({
    roomId: id,
    roomName: room.name,
    items: assignments.map((a) => ({
      assignmentId: a.id,
      printer: a.printer,
    })),
  });
}

/**
 * POST /api/admin/rooms/[id]/printers — assign a printer to this room.
 * Requires manage_programs. Idempotent (re-assigning is a no-op).
 */
export async function POST(
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
  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { printerId } = parsed.data;

  const [room, printer] = await Promise.all([
    db.room.findUnique({ where: { id }, select: { id: true, name: true } }),
    db.printer.findUnique({ where: { id: printerId }, select: { id: true, name: true } }),
  ]);
  if (!room) return NextResponse.json({ error: "room not found" }, { status: 404 });
  if (!printer) return NextResponse.json({ error: "printer not found" }, { status: 404 });

  // Upsert against @@unique([roomId, printerId]).
  const assignment = await db.roomPrinter.upsert({
    where: { roomId_printerId: { roomId: id, printerId } },
    create: { roomId: id, printerId },
    update: {},
    select: { id: true },
  });

  await logAudit({
    actorUserId: user.id,
    action: "room.assign_printer",
    entity: "RoomPrinter",
    entityId: assignment.id,
    details: { roomId: id, roomName: room.name, printerId, printerName: printer.name },
  });

  return NextResponse.json({ id: assignment.id }, { status: 201 });
}

/**
 * DELETE /api/admin/rooms/[id]/printers?printerId=... — unassign a printer
 * from this room. We accept the printer id via query (instead of a body) so
 * the call works as a plain fetch DELETE without a body.
 *
 * Requires manage_programs.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const url = new URL(req.url);
  const printerId = url.searchParams.get("printerId");
  if (!printerId) {
    return NextResponse.json(
      { error: "validation", details: { formErrors: ["printerId query param required"] } },
      { status: 400 },
    );
  }

  const existing = await db.roomPrinter.findUnique({
    where: { roomId_printerId: { roomId: id, printerId } },
    include: { room: { select: { name: true } }, printer: { select: { name: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.roomPrinter.delete({
    where: { roomId_printerId: { roomId: id, printerId } },
  });

  await logAudit({
    actorUserId: user.id,
    action: "room.unassign_printer",
    entity: "RoomPrinter",
    entityId: existing.id,
    details: {
      roomId: id,
      roomName: existing.room.name,
      printerId,
      printerName: existing.printer.name,
    },
  });

  return NextResponse.json({ ok: true });
}
