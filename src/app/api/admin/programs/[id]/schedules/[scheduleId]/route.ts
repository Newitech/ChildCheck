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
    weekOfMonth: z.number().int().min(1).max(5).optional().nullable(),
    startTime: z.string().trim().regex(timeRegex).optional(),
    endTime: z.string().trim().regex(timeRegex).optional().nullable(),
    adhocDate: z.string().datetime().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    isActive: z.boolean().optional(),
  });

/**
 * PUT /api/admin/programs/[id]/schedules/[scheduleId] — update a program schedule.
 * DELETE — soft-delete (isActive = false).
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

  const existing = await db.schedule.findUnique({ where: { id: scheduleId } });
  if (!existing || existing.programId !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const data: Record<string, unknown> = {};
  if (d.kind !== undefined) data.kind = d.kind;
  if (d.dayOfWeek !== undefined) data.dayOfWeek = d.dayOfWeek;
  if (d.weekOfMonth !== undefined) data.weekOfMonth = d.weekOfMonth;
  if (d.startTime !== undefined) data.startTime = d.startTime;
  if (d.endTime !== undefined) data.endTime = d.endTime;
  if (d.adhocDate !== undefined) data.adhocDate = d.adhocDate ? new Date(d.adhocDate) : null;
  if (d.notes !== undefined) data.notes = d.notes;
  if (d.isActive !== undefined) data.isActive = d.isActive;

  await db.schedule.update({ where: { id: scheduleId }, data });

  await logAudit({
    actorUserId: user.id,
    action: "program.schedule_update",
    entity: "Schedule",
    entityId: scheduleId,
    details: { programId: id },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; scheduleId: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, scheduleId } = await ctx.params;

  const existing = await db.schedule.findUnique({ where: { id: scheduleId } });
  if (!existing || existing.programId !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.schedule.delete({ where: { id: scheduleId } });

  await logAudit({
    actorUserId: user.id,
    action: "program.schedule_delete",
    entity: "Schedule",
    entityId: scheduleId,
    details: { programId: id },
  });

  return NextResponse.json({ ok: true });
}
