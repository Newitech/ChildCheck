import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { verifyPin, isValidPin } from "@/lib/password";
import { logAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  signGuardianSession,
  guardianCookieOptions,
  GUARDIAN_COOKIE,
} from "@/lib/guardian-session";

export const dynamic = "force-dynamic";

const schema = z.object({
  familyId: z.string().min(1),
  pin: z.string().min(1).max(32),
});

// In-memory rate limit: 5 attempts / 60s per family (matches the kiosk).
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60_000;
const rateMap = new Map<string, { count: number; resetAt: number }>();

function rateCheck(key: string): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true, retryAfterMs: 0 };
  }
  if (entry.count >= RATE_MAX) {
    return { ok: false, retryAfterMs: entry.resetAt - now };
  }
  entry.count += 1;
  return { ok: true, retryAfterMs: 0 };
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

/**
 * POST /api/guardian/signin
 *
 * Body: { familyId, pin }
 *
 * Verifies the personal guardian PIN (the same PIN used at the kiosk — stored
 * as Person.pinHash) against the family's PrimaryCarer / AuthorisedGuardian
 * members. On success, issues a signed HttpOnly session cookie (cc_guardian)
 * and returns the carer identity. On failure returns a structured error.
 *
 * Gated by the `guardian_pin_signin` feature flag. Rate-limited 5/min/family.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);

  // Feature flag gate.
  const pinSigninOn = await isFeatureEnabled("guardian_pin_signin");
  if (!pinSigninOn) {
    return NextResponse.json(
      { error: "pin_signin_disabled" },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { familyId, pin } = parsed.data;

  // Format-check the PIN before consuming a rate-limit slot (cheap rejection).
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: "invalid_pin" }, { status: 401 });
  }

  // Rate limit (per family — an attacker needs a family id to try a PIN).
  const rl = rateCheck(`guardian-signin:${familyId}`);
  if (!rl.ok) {
    await logAudit({
      actorUserId: null,
      action: "guardian.signin_rate_limited",
      entity: "Family",
      entityId: familyId,
      details: { ip },
    });
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: rl.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  // Look up the family + its adult carers with their pinHash (PIN lives on
  // Person now, not User).
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
    return NextResponse.json({ error: "family_not_found" }, { status: 404 });
  }

  // Try each adult's pinHash. Stop on the first match (same as kiosk route).
  let matched: {
    personId: string;
    firstName: string;
    lastName: string;
    role: "PrimaryCarer" | "AuthorisedGuardian";
  } | null = null;
  for (const m of family.members) {
    if (!m.person.pinHash) continue;
    const ok = await verifyPin(pin, m.person.pinHash);
    if (ok) {
      matched = {
        personId: m.person.id,
        firstName: m.person.firstName,
        lastName: m.person.lastName,
        role: m.role as "PrimaryCarer" | "AuthorisedGuardian",
      };
      break;
    }
  }

  if (!matched) {
    await logAudit({
      actorUserId: null,
      action: "guardian.signin_failed",
      entity: "Family",
      entityId: familyId,
      details: { ip }, // never log the PIN
    });
    return NextResponse.json({ error: "invalid_pin" }, { status: 401 });
  }

  // Issue the signed session cookie.
  const cookieValue = signGuardianSession({
    personId: matched.personId,
    familyId,
  });

  await logAudit({
    actorPersonId: matched.personId,
    action: "guardian.session_start",
    entity: "Family",
    entityId: familyId,
    details: { ip },
  });

  const res = NextResponse.json({
    ok: true,
    personId: matched.personId,
    name: { firstName: matched.firstName, lastName: matched.lastName },
    role: matched.role,
    familyName: family.familyName,
  });
  res.cookies.set(GUARDIAN_COOKIE, cookieValue, guardianCookieOptions());
  return res;
}
