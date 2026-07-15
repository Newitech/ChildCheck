import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { hashPin } from "@/lib/password";

export const dynamic = "force-dynamic";

// A PIN is 4–6 digits. An empty/null/"" value CLEARS the PIN.
const schema = z.object({
  pin: z
    .union([z.string().regex(/^\d{4,6}$/), z.literal("")])
    .optional()
    .nullable(),
});

/**
 * POST /api/admin/people/[id]/pin
 *
 * Set or clear the guardian/kiosk PIN for a Person. The PIN lives on
 * Person.pinHash (not User), so this works for any adult carer — with or
 * without a login account.
 *
 * Body: { pin: string }  (4–6 digits, or empty/null to clear)
 *
 * - Empty/null/"" → clear pinHash. Audit `person.pin_cleared`.
 * - Otherwise     → hash + update pinHash. Audit `person.pin_set`.
 *
 * Permission: manage_people (PeopleManager + Admin). Replaces the old
 * Admin-only /api/admin/users/[id]/set-pin.
 * Never returns the hash.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const person = await db.person.findUnique({
    where: { id },
    select: { firstName: true, lastName: true },
  });
  if (!person) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const pin = parsed.data.pin ?? "";
  const pinHash = pin ? await hashPin(pin) : null;
  await db.person.update({ where: { id }, data: { pinHash } });

  await logAudit({
    actorUserId: user.id,
    action: pin ? "person.pin_set" : "person.pin_cleared",
    entity: "Person",
    entityId: id,
    details: {
      personId: id,
      personName: `${person.firstName} ${person.lastName}`,
    },
  });

  return NextResponse.json({ ok: true, hasPin: !!pin });
}
