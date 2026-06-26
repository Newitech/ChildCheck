import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long (max 128)"),
});

/**
 * POST /api/admin/users/[id]/reset-password
 *
 * Body: { password: string }
 *
 * Hashes the new password + updates passwordHash. Audit-logs
 * `user.password_reset`. Returns `{ ok }`. Never returns the hash.
 */
export async function POST(
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
    select: { id: true, username: true },
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
    return NextResponse.json({ error: firstError }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db.user.update({ where: { id }, data: { passwordHash } });

  await logAudit({
    actorUserId: actor.id,
    action: "user.password_reset",
    entity: "User",
    entityId: id,
    details: { username: existing.username },
  });

  return NextResponse.json({ ok: true });
}
