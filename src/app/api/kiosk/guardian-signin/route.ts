import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getFeatureFlags } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyPin, isValidPin } from "@/lib/password";

export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/guardian-signin
 *
 * Verify a guardian's PIN against their family's adult members, returning the
 * verified Adult Person so the kiosk can attribute the subsequent check-in to
 * them (via /api/kiosk/checkin with method "guardian_pin").
 *
 * Why this design (vs creating a NextAuth session):
 *   - Guardians may not know their username at the kiosk — only their PIN.
 *   - A full NextAuth session for a transient kiosk flow is overkill; we need
 *     just enough server-side trust for the next call.
 *   - The check-in API re-verifies `checkedInByPersonId` is actually a
 *     PrimaryCarer/AuthorisedGuardian of the family, so a stolen token can't
 *     be replayed against a different family.
 *
 * Flow:
 *   kiosk → POST { familyId, pin } → 200 { ok, personId, name } | 401 | 429
 *   kiosk → POST /api/kiosk/checkin { ..., method: "guardian_pin",
 *                                      checkedInByPersonId: personId }
 *
 * Rate limiting: 5 attempts / minute / family. This prevents PIN brute-forcing
 * (a 4-digit PIN has 10⁴ = 10000 possibilities; at 5/min that's ~33 hours per
 * family, plus the family-id requirement means attackers must already know
 * which family to target).
 *
 * Body: { familyId: string, pin: string }
 * Returns:
 *   200 { ok: true, personId, name: { firstName, lastName } }
 *   400 { error: "validation" }
 *   401 { error: "invalid_pin" }
 *   404 { error: "family_not_found" }
 *   409 { error: "pin_signin_disabled" }
 *   429 { error: "rate_limited", retryAfterMs }
 */

const bodySchema = z.object({
  familyId: z.string().min(1),
  pin: z.string().min(1).max(32),
});

// 5 attempts / minute / family.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(req: Request) {
  // -----------------------------------------------------------------------
  // Feature flag gate.
  // -----------------------------------------------------------------------
  const flags = await getFeatureFlags();
  if (!flags.guardian_pin_signin) {
    return NextResponse.json(
      { error: "pin_signin_disabled" },
      { status: 409 },
    );
  }

  // -----------------------------------------------------------------------
  // Parse + validate.
  // -----------------------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { familyId, pin } = parsed.data;

  // Quick format check — reject obviously-invalid PINs without consuming a
  // rate-limit slot. (We accept 4–6 digit PINs to match isValidPin().)
  if (!isValidPin(pin)) {
    return NextResponse.json(
      { error: "invalid_pin" },
      { status: 401 },
    );
  }

  // -----------------------------------------------------------------------
  // Rate limit per family (not per IP) — a family is the unit an attacker
  // would target.
  // -----------------------------------------------------------------------
  const ip = getClientIp(req);
  const rlKey = `pin:${familyId}`;
  const rl = rateLimit(rlKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rl.ok) {
    await logAudit({
      actorUserId: null,
      action: "guardian.pin_rate_limited",
      entity: "Family",
      entityId: familyId,
      details: { ip },
    });
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: rl.retryAfterMs },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      },
    );
  }

  // -----------------------------------------------------------------------
  // Look up the family + its adult members (PrimaryCarer / AuthorisedGuardian)
  // with their PIN (PIN lives on Person, not User).
  // -----------------------------------------------------------------------
  const family = await db.family.findUnique({
    where: { id: familyId, isActive: true },
    select: {
      id: true,
      familyName: true,
      members: {
        where: {
          role: { in: ["PrimaryCarer", "AuthorisedGuardian"] },
          person: { personType: "Adult", isActive: true },
        },
        include: {
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              pinHash: true,
            },
          },
        },
      },
    },
  });
  if (!family) {
    return NextResponse.json(
      { error: "family_not_found" },
      { status: 404 },
    );
  }

  // Try each adult's pinHash. Stop on the first match.
  let matched: {
    personId: string;
    firstName: string;
    lastName: string;
    role: string;
  } | null = null;
  for (const m of family.members) {
    if (!m.person.pinHash) continue;
    const ok = await verifyPin(pin, m.person.pinHash);
    if (ok) {
      matched = {
        personId: m.person.id,
        firstName: m.person.firstName,
        lastName: m.person.lastName,
        role: m.role,
      };
      break;
    }
  }

  if (!matched) {
    await logAudit({
      actorUserId: null,
      action: "guardian.pin_verify_failed",
      entity: "Family",
      entityId: familyId,
      details: { ip }, // never log the PIN
    });
    return NextResponse.json(
      { error: "invalid_pin" },
      { status: 401 },
    );
  }

  await logAudit({
    actorUserId: null,
    action: "guardian.pin_verify_ok",
    entity: "Family",
    entityId: familyId,
    details: {
      personId: matched.personId,
      role: matched.role,
      ip,
    },
  });

  return NextResponse.json({
    ok: true,
    personId: matched.personId,
    name: { firstName: matched.firstName, lastName: matched.lastName },
    role: matched.role,
  });
}
