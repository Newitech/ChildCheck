import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const createSchema = z
  .object({
    kind: z.enum(["recurring", "adhoc"]),
    dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
    weekOfMonth: z.number().int().min(1).max(5).optional().nullable(),
    startTime: z
      .string()
      .trim()
      .regex(timeRegex, "startTime must be HH:MM 24h"),
    endTime: z
      .string()
      .trim()
      .regex(timeRegex, "endTime must be HH:MM 24h")
      .optional()
      .nullable(),
    adhocDate: z.string().datetime().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine(
    (d) => (d.kind === "recurring" && d.dayOfWeek !== null && d.dayOfWeek !== undefined) || d.kind === "adhoc",
    { message: "recurring schedule requires dayOfWeek", path: ["dayOfWeek"] },
  )
  .refine(
    (d) => (d.kind === "adhoc" && d.adhocDate) || d.kind === "recurring",
    { message: "adhoc schedule requires adhocDate", path: ["adhocDate"] },
  )
  .refine(
    (d) => {
      if (!d.endTime) return true;
      // endTime must be after startTime.
      return d.endTime > d.startTime;
    },
    { message: "endTime must be after startTime", path: ["endTime"] },
  );

/**
 * GET /api/admin/classes/[id]/schedules — list schedules for a class.
 *
 * Route is mounted at /api/admin/classes/[id]/schedules (without the
 * program id, since the class id is unique). The [id] param is the class id.
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

  const cls = await db.groupClass.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!cls) {
    return NextResponse.json({ error: "class not found" }, { status: 404 });
  }

  const schedules = await db.schedule.findMany({
    where: { classId: id, isActive: true },
    orderBy: [{ kind: "asc" }, { dayOfWeek: "asc" }, { adhocDate: "asc" }],
  });

  return NextResponse.json({
    items: schedules.map((s) => ({
      id: s.id,
      classId: s.classId,
      kind: s.kind,
      dayOfWeek: s.dayOfWeek,
      weekOfMonth: s.weekOfMonth,
      startTime: s.startTime,
      endTime: s.endTime,
      adhocDate: s.adhocDate ? s.adhocDate.toISOString() : null,
      notes: s.notes,
      isActive: s.isActive,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
}

/**
 * POST /api/admin/classes/[id]/schedules — create a schedule for a class.
 * Requires manage_programs permission.
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

  const cls = await db.groupClass.findUnique({
    where: { id },
    select: { id: true, programId: true, name: true, slug: true },
  });
  if (!cls) {
    return NextResponse.json({ error: "class not found" }, { status: 404 });
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

  const created = await db.schedule.create({
    data: {
      classId: id,
      programId: null,
      kind: p.kind,
      dayOfWeek: p.kind === "recurring" ? p.dayOfWeek ?? null : null,
      weekOfMonth: p.kind === "recurring" ? (p.weekOfMonth ?? null) : null,
      startTime: p.startTime,
      endTime: p.endTime ?? null,
      adhocDate:
        p.kind === "adhoc" && p.adhocDate ? new Date(p.adhocDate) : null,
      notes: p.notes ?? null,
      isActive: true,
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "schedule.add",
    entity: "Schedule",
    entityId: created.id,
    details: {
      classId: id,
      programId: cls.programId,
      kind: created.kind,
      dayOfWeek: created.dayOfWeek,
      startTime: created.startTime,
      endTime: created.endTime,
      adhocDate: created.adhocDate ? created.adhocDate.toISOString() : null,
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
