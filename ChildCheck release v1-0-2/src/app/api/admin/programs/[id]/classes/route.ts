import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const slugRegex = /^[a-z0-9_]+$/;

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(slugRegex, "slug must be lowercase letters, digits, or underscore")
    .optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  ageMin: z.number().int().min(0).max(130).optional().nullable(),
  ageMax: z.number().int().min(0).max(130).optional().nullable(),
  gradeLevel: z.string().trim().max(60).optional().nullable(),
  roomId: z.string().min(1).max(60).optional().nullable(),
  sortOrder: z.number().int().min(0).optional().default(0),
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * GET /api/admin/programs/[id]/classes — list classes in a program.
 * Each class includes its room + schedule summary.
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
    select: { id: true },
  });
  if (!program) {
    return NextResponse.json({ error: "program not found" }, { status: 404 });
  }

  const classes = await db.groupClass.findMany({
    where: { programId: id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      room: { select: { id: true, name: true, code: true, building: true } },
      schedules: { where: { isActive: true } },
    },
  });

  return NextResponse.json({
    items: classes.map((c) => ({
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
    })),
  });
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  return schedules
    .map((s) => {
      if (s.kind === "recurring") {
        const day =
          s.dayOfWeek !== null && s.dayOfWeek >= 0 && s.dayOfWeek <= 6
            ? DAY_NAMES[s.dayOfWeek]
            : "?";
        const end = s.endTime ? `–${s.endTime}` : "";
        return `${day} ${s.startTime}${end}`;
      }
      const d = s.adhocDate ? new Date(s.adhocDate) : null;
      return d
        ? `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${s.startTime}`
        : `Adhoc ${s.startTime}`;
    })
    .join(" · ");
}

/**
 * POST /api/admin/programs/[id]/classes — create a class in a program.
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

  const program = await db.program.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!program) {
    return NextResponse.json({ error: "program not found" }, { status: 404 });
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

  // Derive slug from name if not provided.
  let slug = p.slug;
  if (!slug) {
    slug = slugify(p.name);
  } else if (!slugRegex.test(slug)) {
    slug = slugify(slug);
  }
  if (!slug) {
    return NextResponse.json(
      { error: "Could not derive a valid slug from the class name" },
      { status: 400 },
    );
  }

  // Enforce (programId, slug) uniqueness.
  const existing = await db.groupClass.findUnique({
    where: { programId_slug: { programId: id, slug } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "A class with that slug already exists in this program" },
      { status: 409 },
    );
  }

  // Validate room if provided.
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

  // ageMax must be ≥ ageMin when both set.
  if (p.ageMin !== null && p.ageMin !== undefined && p.ageMax !== null && p.ageMax !== undefined && p.ageMax < p.ageMin) {
    return NextResponse.json(
      { error: "ageMax must be ≥ ageMin" },
      { status: 400 },
    );
  }

  const created = await db.groupClass.create({
    data: {
      programId: id,
      slug,
      name: p.name,
      description: p.description ?? null,
      ageMin: p.ageMin ?? null,
      ageMax: p.ageMax ?? null,
      gradeLevel: p.gradeLevel ?? null,
      roomId: p.roomId ?? null,
      sortOrder: p.sortOrder,
      isActive: true,
      isDefault: false,
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "class.add",
    entity: "GroupClass",
    entityId: created.id,
    details: { programId: id, slug: created.slug, name: created.name, roomId: created.roomId },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
