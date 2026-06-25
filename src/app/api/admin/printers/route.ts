import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DRIVER_VALUES = ["browser", "qz_tray", "thermal_raw"] as const;
const PURPOSE_VALUES = ["label", "slip", "both"] as const;

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  driver: z.enum(DRIVER_VALUES).default("browser"),
  queueName: z.string().trim().max(120).optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  purpose: z.enum(PURPOSE_VALUES).default("both"),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Optional list of room IDs to assign this printer to on create. */
  roomIds: z.array(z.string().min(1)).optional(),
});

/**
 * GET /api/admin/printers — list all printers.
 *
 * Query:
 *   includeInactive=true → include soft-deleted (isActive=false) printers.
 *   purpose=label|slip|both → filter by purpose.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const purposeFilter = url.searchParams.get("purpose");

  const where: { isActive?: boolean; purpose?: string } = {};
  if (!includeInactive) where.isActive = true;
  if (purposeFilter && (PURPOSE_VALUES as readonly string[]).includes(purposeFilter)) {
    where.purpose = purposeFilter;
  }

  const printers = await db.printer.findMany({
    where,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: {
      rooms: { include: { room: { select: { id: true, name: true, code: true } } } },
    },
  });

  return NextResponse.json({
    items: printers.map((p) => ({
      id: p.id,
      name: p.name,
      driver: p.driver,
      queueName: p.queueName,
      isDefault: p.isDefault,
      isActive: p.isActive,
      purpose: p.purpose,
      notes: p.notes,
      rooms: p.rooms.map((rp) => ({
        id: rp.id,
        roomId: rp.room.id,
        roomName: rp.room.name,
        roomCode: rp.room.code,
      })),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}

/**
 * POST /api/admin/printers — create a printer.
 * Requires manage_programs permission (printers are part of the room/program
 * configuration surface).
 *
 * If `isDefault: true`, all other printers' isDefault is cleared so there's
 * exactly one default at a time.
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

  // Validate referenced rooms exist (if any).
  if (p.roomIds && p.roomIds.length > 0) {
    const found = await db.room.count({ where: { id: { in: p.roomIds } } });
    if (found !== p.roomIds.length) {
      return NextResponse.json(
        { error: "validation", details: { formErrors: ["One or more rooms not found"] } },
        { status: 400 },
      );
    }
  }

  // Enforce single default.
  if (p.isDefault) {
    await db.printer.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  const created = await db.printer.create({
    data: {
      name: p.name,
      driver: p.driver,
      queueName: p.queueName ?? null,
      isDefault: p.isDefault ?? false,
      isActive: p.isActive ?? true,
      purpose: p.purpose,
      notes: p.notes ?? null,
      rooms: p.roomIds && p.roomIds.length > 0
        ? { create: p.roomIds.map((roomId) => ({ roomId })) }
        : undefined,
    },
    include: { rooms: true },
  });

  await logAudit({
    actorUserId: user.id,
    action: "printer.add",
    entity: "Printer",
    entityId: created.id,
    details: {
      name: created.name,
      driver: created.driver,
      queueName: created.queueName,
      purpose: created.purpose,
      isDefault: created.isDefault,
      roomIds: p.roomIds ?? [],
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
