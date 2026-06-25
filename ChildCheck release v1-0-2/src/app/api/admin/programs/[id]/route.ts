import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  color: z.string().trim().max(20).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/admin/programs/[id] — program detail with classes (each class
 * includes its assigned room + a schedule summary string).
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

  const program = await db.program.findUnique({
    where: { id },
    include: {
      classes: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          room: { select: { id: true, name: true, code: true, building: true } },
          schedules: {
            where: { isActive: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      events: {
        where: { isActive: true },
        orderBy: { date: "asc" },
        select: { id: true, name: true, date: true, location: true },
      },
    },
  });
  if (!program) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: program.id,
    slug: program.slug,
    name: program.name,
    description: program.description,
    color: program.color,
    sortOrder: program.sortOrder,
    isActive: program.isActive,
    isDefault: program.isDefault,
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString(),
    classes: program.classes.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      ageMin: c.ageMin,
      ageMax: c.ageMax,
      gradeLevel: c.gradeLevel,
      sortOrder: c.sortOrder,
      isDefault: c.isDefault,
      isActive: c.isActive,
      room: c.room,
      scheduleSummary: summarizeSchedules(c.schedules),
      schedules: c.schedules.map((s) => ({
        id: s.id,
        kind: s.kind,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        adhocDate: s.adhocDate ? s.adhocDate.toISOString() : null,
        notes: s.notes,
        isActive: s.isActive,
      })),
    })),
    events: program.events.map((e) => ({
      id: e.id,
      name: e.name,
      date: e.date.toISOString(),
      location: e.location,
    })),
  });
}

const DAY_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

function summarizeSchedules(
  schedules: Array<{
    kind: string;
    dayOfWeek: number | null;
    startTime: string;
    endTime: string | null;
    adhocDate: Date | null;
  }>,
): string {
  if (schedules.length === 0) return "No schedule";
  const parts = schedules.map((s) => {
    if (s.kind === "recurring") {
      const day =
        s.dayOfWeek !== null && s.dayOfWeek >= 0 && s.dayOfWeek <= 6
          ? DAY_NAMES[s.dayOfWeek]
          : "?";
      const end = s.endTime ? `–${s.endTime}` : "";
      return `${day} ${s.startTime}${end}`;
    }
    // adhoc
    const d = s.adhocDate ? new Date(s.adhocDate) : null;
    const dStr = d
      ? `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${s.startTime}`
      : `Adhoc ${s.startTime}`;
    return dStr;
  });
  return parts.join(" · ");
}

/**
 * PUT /api/admin/programs/[id] — update a program.
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

  const existing = await db.program.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updated = await db.program.update({
    where: { id },
    data: {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.description !== undefined ? { description: p.description } : {}),
      ...(p.color !== undefined ? { color: p.color } : {}),
      ...(p.sortOrder !== undefined ? { sortOrder: p.sortOrder } : {}),
      ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "program.update",
    entity: "Program",
    entityId: id,
    details: p,
  });

  return NextResponse.json({ id: updated.id });
}

/**
 * DELETE /api/admin/programs/[id] — soft-delete (isActive=false).
 * Requires manage_programs permission.
 *
 * Note: deleting a default program is allowed (admin may not want it); the
 * "Seed default programs" button can restore it later via the seed endpoint.
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

  const existing = await db.program.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.program.update({
    where: { id },
    data: { isActive: false },
  });

  await logAudit({
    actorUserId: user.id,
    action: "program.remove",
    entity: "Program",
    entityId: id,
    details: { slug: existing.slug, name: existing.name, isDefault: existing.isDefault },
  });

  return NextResponse.json({ ok: true });
}
