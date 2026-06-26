import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, ROLE_PERMISSIONS } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const KNOWN_ROLES = Object.keys(ROLE_PERMISSIONS);

const updateSchema = z.object({
  roles: z
    .array(z.string())
    .refine(
      (rs) => rs.every((r) => KNOWN_ROLES.includes(r)),
      "Unknown role in list",
    )
    .optional(),
  status: z.enum(["Active", "Disabled"]).optional(),
});

/**
 * GET /api/admin/users/[id] — full detail for one user.
 *
 * Returns the Person, roles, status, lastLoginAt, and `hasPin` (boolean).
 * NEVER returns passwordHash or pinHash.
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
      roles: { select: { role: true } },
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
    hasPin: !!u.pinHash,
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
    roles: u.roles.map((r) => r.role),
  });
}

/**
 * PUT /api/admin/users/[id] — update roles + status.
 *
 * Body: { roles?: string[], status?: "Active" | "Disabled" }
 *
 * If `roles` is provided, the user's role set is REPLACED (delete all
 * existing UserRole rows, insert new). If `status` is provided, update it.
 * Audit-logs `user.update` with the changes.
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

  const existing = await db.user.findUnique({
    where: { id },
    include: { roles: { select: { role: true } } },
  });
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
  const { roles, status } = parsed.data;

  if (roles === undefined && status === undefined) {
    return NextResponse.json({ ok: true, changed: {} });
  }

  const changed: Record<string, unknown> = {};

  await db.$transaction(async (tx) => {
    if (roles !== undefined) {
      const before = existing.roles.map((r) => r.role).sort();
      const after = [...roles].sort();
      const same =
        before.length === after.length &&
        before.every((v, i) => v === after[i]);
      if (!same) {
        // Delete then re-insert. `skipDuplicates` is not supported by Prisma's
        // SQLite connector for createMany — but it's unnecessary here because
        // we just deleted all rows for this user, and the @@unique([userId,
        // role]) constraint protects against duplicates regardless.
        await tx.userRole.deleteMany({ where: { userId: id } });
        if (roles.length > 0) {
          await tx.userRole.createMany({
            data: roles.map((r) => ({ userId: id, role: r })),
          });
        }
        changed.roles = roles;
      }
    }
    if (status !== undefined && status !== existing.status) {
      await tx.user.update({ where: { id }, data: { status } });
      changed.status = status;
    }
  });

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
