import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  familyName: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(4000).optional().nullable(),
  isActive: z.boolean().optional(),
});

function nullIfEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

/** GET /api/admin/families/[id] — full detail. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const family = await db.family.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              personType: true,
              email: true,
              phone: true,
              photoPath: true,
              isVisitor: true,
              isActive: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!family) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: family.id,
    familyName: family.familyName,
    notes: family.notes,
    isActive: family.isActive,
    createdAt: family.createdAt.toISOString(),
    members: family.members.map((m) => ({
      id: m.id,
      role: m.role,
      person: {
        id: m.person.id,
        firstName: m.person.firstName,
        lastName: m.person.lastName,
        preferredName: m.person.preferredName,
        personType: m.person.personType,
        email: m.person.email,
        phone: m.person.phone,
        hasPhoto: !!m.person.photoPath,
        isVisitor: m.person.isVisitor,
        isActive: m.person.isActive,
      },
    })),
  });
}

/** PUT /api/admin/families/[id] — update familyName / notes / isActive. */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const existing = await db.family.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
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

  const data: Record<string, unknown> = {};
  const changed: Record<string, unknown> = {};

  if (p.familyName !== undefined && p.familyName !== existing.familyName) {
    data.familyName = p.familyName;
    changed.familyName = p.familyName;
  }
  if (p.notes !== undefined) {
    const v = nullIfEmpty(p.notes);
    if (v !== existing.notes) {
      data.notes = v;
      changed.notes = v;
    }
  }
  if (p.isActive !== undefined && p.isActive !== existing.isActive) {
    data.isActive = p.isActive;
    changed.isActive = p.isActive;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, changed: {} });
  }

  await db.family.update({ where: { id }, data });

  await logAudit({
    actorUserId: user.id,
    action: "family.update",
    entity: "Family",
    entityId: id,
    details: changed,
  });

  return NextResponse.json({ ok: true, changed });
}

/** DELETE /api/admin/families/[id] — soft-delete (isActive=false). */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const family = await db.family.findUnique({ where: { id } });
  if (!family) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!family.isActive) {
    return NextResponse.json({ ok: true, alreadyInactive: true });
  }

  await db.family.update({ where: { id }, data: { isActive: false } });

  await logAudit({
    actorUserId: user.id,
    action: "family.delete",
    entity: "Family",
    entityId: id,
    details: { softDelete: true, familyName: family.familyName },
  });

  return NextResponse.json({ ok: true });
}
