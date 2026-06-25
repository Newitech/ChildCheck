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
    .regex(slugRegex, "slug must be lowercase letters, digits, or underscore"),
  description: z.string().trim().max(2000).optional().nullable(),
  color: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable(),
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
 * GET /api/admin/programs — list programs with class counts.
 *
 * Query params: includeInactive=true includes soft-deleted programs.
 * Available to any authenticated user.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeInactive =
    url.searchParams.get("includeInactive") === "true";

  const programs = await db.program.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: { classes: { where: { isActive: true } } },
      },
    },
  });

  return NextResponse.json({
    items: programs.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      color: p.color,
      sortOrder: p.sortOrder,
      isActive: p.isActive,
      isDefault: p.isDefault,
      classCount: p._count.classes,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}

/**
 * POST /api/admin/programs — create a program.
 * Requires manage_programs permission.
 *
 * The slug is canonical — auto-slugify from name if missing/invalid.
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

  // Auto-slugify if the provided slug isn't a valid canonical slug.
  let slug = p.slug;
  if (!slugRegex.test(slug)) {
    slug = slugify(p.name);
    if (!slug) {
      return NextResponse.json(
        { error: "Could not derive a valid slug from the program name" },
        { status: 400 },
      );
    }
  }

  const existing = await db.program.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json(
      { error: "A program with that slug already exists" },
      { status: 409 },
    );
  }

  const created = await db.program.create({
    data: {
      slug,
      name: p.name,
      description: p.description ?? null,
      color: p.color ?? null,
      sortOrder: p.sortOrder,
      isActive: true,
      isDefault: false,
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "program.add",
    entity: "Program",
    entityId: created.id,
    details: { slug: created.slug, name: created.name },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
