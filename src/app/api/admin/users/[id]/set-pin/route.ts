import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hashPin, isValidPin } from "@/lib/password";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  pin: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => v == null || v === "" || isValidPin(v), {
      message: "PIN must be 4–6 digits",
    }),
});

/**
 * POST /api/admin/users/[id]/set-pin
 *
 * Body: { pin: string }  (4–6 digits, or empty/null to clear)
 *
 * - Empty/null → clear pinHash (set null). Audit-logs `user.pin_cleared`.
 * - Otherwise   → hash + update pinHash.       Audit-logs `user.pin_set`.
 *
 * Returns `{ ok, hasPin }`. Never returns the hash.
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
    select: { id: true, username: true, pinHash: true },
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

  const pin = parsed.data.pin;
  if (pin == null || pin === "") {
    // Clear.
    await db.user.update({ where: { id }, data: { pinHash: null } });
    await logAudit({
      actorUserId: actor.id,
      action: "user.pin_cleared",
      entity: "User",
      entityId: id,
      details: { username: existing.username },
    });
    return NextResponse.json({ ok: true, hasPin: false });
  }

  const pinHash = await hashPin(pin);
  await db.user.update({ where: { id }, data: { pinHash } });
  await logAudit({
    actorUserId: actor.id,
    action: "user.pin_set",
    entity: "User",
    entityId: id,
    details: { username: existing.username },
  });
  return NextResponse.json({ ok: true, hasPin: true });
}
