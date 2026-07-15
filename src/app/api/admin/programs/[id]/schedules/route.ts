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
    (d) => { if (!d.endTime) return true; return d.endTime > d.startTime; },
    { message: "endTime must be after startTime", path: ["endTime"] },
  );

/**
 * GET /api/admin/programs/[id]/schedules — list program-level schedules.
 * These apply to ALL classes in the program.
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

  const prog = await db.program.findUnique({ where: { id }, select: { id: true } });
  if (!prog) {
    return NextResponse.json({ error: "program not found" }, { status: 404 });
  }

  const schedules = await db.schedule.findMany({
    where: { programId: id, isActive: true },
    orderBy: [{ kind: "asc" }, { dayOfWeek: "asc" }, { adhocDate: "asc" }],
  });

  return NextResponse.json({
    items: schedules.map((s) => ({
      id: s.id,
      kind: s.kind,
      dayOfWeek: s.dayOfWeek,
      weekOfMonth: s.weekOfMonth,
      startTime: s.startTime,
      endTime: s.endTime,
      adhocDate: s.adhocDate?.toISOString() ?? null,
      notes: s.notes,
    })),
  });
}

/**
 * POST /api/admin/programs/[id]/schedules — create a program-level schedule.
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

  const prog = await db.program.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!prog) {
    return NextResponse.json({ error: "program not found" }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const created = await db.schedule.create({
    data: {
      programId: id,
      classId: null,
      kind: d.kind,
      dayOfWeek: d.kind === "recurring" ? d.dayOfWeek! : null,
      weekOfMonth: d.kind === "recurring" ? (d.weekOfMonth ?? null) : null,
      startTime: d.startTime,
      endTime: d.endTime ?? null,
      adhocDate: d.kind === "adhoc" && d.adhocDate ? new Date(d.adhocDate) : null,
      notes: d.notes ?? null,
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "program.schedule_create",
    entity: "Schedule",
    entityId: created.id,
    details: { programId: id, programName: prog.name, kind: d.kind },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
