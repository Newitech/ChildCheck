import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { hashPin, verifyPin, isValidPin } from "@/lib/password";
import { logAudit } from "@/lib/audit";
import { getGuardian } from "@/lib/guardian-session";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** The current PIN. Required when a pinHash already exists (changing).
   *  May be omitted when no pinHash is set yet (first-time set). */
  currentPin: z.string().min(1).max(32).optional(),
  /** The new PIN (4–6 digits). */
  newPin: z.string().min(1).max(32),
});

function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/**
 * POST /api/guardian/pin
 *
 * Change (or set) the signed-in carer's personal guardian PIN — the same PIN
 * used at the kiosk for guardian sign-in and check-out. Changing it here takes
 * effect immediately at both the portal and the kiosk (same Person.pinHash).
 *
 * Body: { currentPin?, newPin }
 *
 * - If the carer already has a pinHash: `currentPin` is required and must
 *   verify against the existing hash.
 * - If no pinHash exists yet (first-time set): `currentPin` may be omitted.
 * - `newPin` must be 4–6 digits (valid PIN format).
 */
export async function POST(req: Request) {
  const g = await getGuardian();
  if (!g) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  const { currentPin, newPin } = parsed.data;

  if (!isValidPin(newPin)) {
    return NextResponse.json(
      { error: "New PIN must be 4–6 digits." },
      { status: 400 },
    );
  }

  // Look up the carer's Person row. The PIN lives on Person, so a login
  // account is NOT required to set/change it.
  const person = await db.person.findUnique({
    where: { id: g.personId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      pinHash: true,
    },
  });
  if (!person) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // If an existing pinHash is set, the current PIN must verify.
  if (person.pinHash) {
    if (!currentPin) {
      return NextResponse.json(
        { error: "Enter your current PIN to confirm." },
        { status: 400 },
      );
    }
    const ok = await verifyPin(currentPin, person.pinHash);
    if (!ok) {
      await logAudit({
        actorPersonId: g.personId,
        action: "guardian.pin_change_failed",
        entity: "Person",
        entityId: person.id,
        details: { reason: "wrong_current_pin" },
        ip: clientIp(req),
      });
      return NextResponse.json(
        { error: "Current PIN is incorrect." },
        { status: 401 },
      );
    }
  }

  // Hash and save the new PIN.
  const newHash = await hashPin(newPin);
  await db.person.update({
    where: { id: person.id },
    data: { pinHash: newHash },
  });

  const ip = clientIp(req);
  await logAudit({
    actorPersonId: g.personId,
    action: "guardian.pin_changed",
    entity: "Person",
    entityId: person.id,
    details: { firstTime: !person.pinHash }, // true for first set, false for change
    ip,
  });

  return NextResponse.json({ ok: true, hasPin: true });
}
