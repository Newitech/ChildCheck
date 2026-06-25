import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const updateSchema = z
  .object({
    kind: z.enum(["recurring", "adhoc"]).optional(),
    dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
    startTime: z
      .string()
      .trim()
      .regex(timeRegex, "startTime must be HH:MM 24h")
      .optional(),
    endTime: z
      .string()
      .trim()
      .regex(timeRegex, "endTime must be HH:MM 24h")
      .optional()
      .nullable(),
    adhocDate: z.string().datetime().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (d) => {
      // If both startTime + endTime supplied, endTime must be > startTime.
      if (d.startTime && d.endTime) return d.endTime > d.startTime;
      return true;
    },
    { message: "endTime must be after startTime", path: ["endTime"] },
  );

/**
 * PUT /api/admin/classes/[id]/schedules/[scheduleId] — update a schedule.
 * Requires manage_programs permission.
 *
 * Validation:
 *  - recurring kind requires dayOfWeek (after merge with existing).
 *  - adhoc kind requires adhocDate.
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; scheduleId: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, scheduleId } = await ctx.params;

  const existing = await db.schedule.findUnique({
    where: { id: scheduleId },
  });
  if (!existing) {
    return NextResponse.json({ error: "schedule not found" }, { status: 404 });
  }
  if (existing.classId !== id) {
    return NextResponse.json(
      { error: "schedule does not belong to this class" },
      { status: 400 },
    );
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

  const kind = p.kind ?? existing.kind;
  const dayOfWeek = p.dayOfWeek !== undefined ? p.dayOfWeek : existing.dayOfWeek;
  const adhocDate =
    p.adhocDate !== undefined
      ? p.adhocDate
        ? new Date(p.adhocDate)
        : null
      : existing.adhocDate;

  if (kind === "recurring" && (dayOfWeek === null || dayOfWeek === undefined)) {
    return NextResponse.json(
      { error: "recurring schedule requires dayOfWeek" },
      { status: 400 },
    );
  }
  if (kind === "adhoc" && !adhocDate) {
    return NextResponse.json(
      { error: "adhoc schedule requires adhocDate" },
      { status: 400 },
    );
  }

  const updated = await db.schedule.update({
    where: { id: scheduleId },
    data: {
      ...(p.kind !== undefined ? { kind: p.kind } : {}),
      ...(p.dayOfWeek !== undefined ? { dayOfWeek: p.dayOfWeek } : {}),
      ...(p.startTime !== undefined ? { startTime: p.startTime } : {}),
      ...(p.endTime !== undefined ? { endTime: p.endTime } : {}),
      ...(p.adhocDate !== undefined ? { adhocDate } : {}),
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
      ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "schedule.update",
    entity: "Schedule",
    entityId: scheduleId,
    details: { classId: id, changes: p },
  });

  return NextResponse.json({ id: updated.id });
}

/**
 * DELETE /api/admin/classes/[id]/schedules/[scheduleId] — soft-delete a schedule.
 * Requires manage_programs permission.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; scheduleId: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, scheduleId } = await ctx.params;

  const existing = await db.schedule.findUnique({
    where: { id: scheduleId },
    select: { id: true, classId: true, kind: true, dayOfWeek: true, startTime: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "schedule not found" }, { status: 404 });
  }
  if (existing.classId !== id) {
    return NextResponse.json(
      { error: "schedule does not belong to this class" },
      { status: 400 },
    );
  }

  await db.schedule.update({
    where: { id: scheduleId },
    data: { isActive: false },
  });

  await logAudit({
    actorUserId: user.id,
    action: "schedule.remove",
    entity: "Schedule",
    entityId: scheduleId,
    details: {
      classId: id,
      kind: existing.kind,
      dayOfWeek: existing.dayOfWeek,
      startTime: existing.startTime,
    },
  });

  return NextResponse.json({ ok: true });
}
