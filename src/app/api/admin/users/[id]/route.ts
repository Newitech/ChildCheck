import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  status: z.enum(["Active", "Disabled"]).optional(),
});

/**
 * GET /api/admin/users/[id] — full detail for one login account.
 *
 * LOGIN-ONLY: username + status + lastLoginAt + linked Person. Roles + PIN
 * live on Person (PersonRole + Person.pinHash) — fetch them via
 * /api/admin/people/[id]. NEVER returns passwordHash.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await getCurrentUser();
  if (!actor || !actor.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const u = await db.user.findUnique({
    where: { id },
    include: {
      person: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          email: true,
          personType: true,
        },
      },
    },
  });
  if (!u) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: u.id,
    personId: u.personId,
    username: u.username,
    status: u.status,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    person: u.person
      ? {
          id: u.person.id,
          firstName: u.person.firstName,
          lastName: u.person.lastName,
          preferredName: u.person.preferredName,
          email: u.person.email,
          personType: u.person.personType,
        }
      : null,
  });
}

/**
 * PUT /api/admin/users/[id] — update login-account status.
 *
 * Body: { status?: "Active" | "Disabled" }
 *
 * Roles are no longer edited here (they live on Person via PersonRole — use
 * /api/admin/people/[id]/roles). PIN lives on Person.pinHash — use
 * /api/admin/people/[id]/pin.
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await getCurrentUser();
  if (!actor || !actor.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
    return NextResponse.json({ error: firstError }, { status: 400 });
  }
  const { status } = parsed.data;

  if (status === undefined) {
    return NextResponse.json({ ok: true, changed: {} });
  }

  const changed: Record<string, unknown> = {};

  if (status !== existing.status) {
    await db.user.update({ where: { id }, data: { status } });
    changed.status = status;
  }

  if (Object.keys(changed).length === 0) {
    return NextResponse.json({ ok: true, changed: {} });
  }

  await logAudit({
    actorUserId: actor.id,
    action: "user.update",
    entity: "User",
    entityId: id,
    details: { ...changed, username: existing.username },
  });

  return NextResponse.json({ ok: true, changed });
}
