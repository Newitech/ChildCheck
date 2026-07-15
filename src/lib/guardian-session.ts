import crypto from "node:crypto";
import { cookies } from "next/headers";

import { db } from "@/lib/db";

/**
 * Guardian self-service portal session (signed HttpOnly cookie).
 *
 * Unlike the NextAuth session (which authenticates User rows by
 * username+password), this is a lightweight signed-cookie session for a Person
 * who proved they are the PrimaryCarer (or AuthorisedGuardian) of a family by
 * entering their personal guardian PIN — the same PIN used at the kiosk
 * (stored as User.pinHash).
 *
 * Design:
 *   - Cookie `cc_guardian` is HttpOnly, SameSite=Lax, Secure in production.
 *   - Value = base64url(payload) + "." + base64url(HMAC-SHA256(payload)).
 *   - Payload (JSON) = { pid: personId, fid: familyId, iat: issued-at-ms }.
 *   - Key is domain-separated from NEXTAUTH_SECRET by suffixing
 *     "|guardian-session-v1" so a NextAuth secret compromise alone can't be
 *     trivially reused to mint guardian sessions (and vice-versa).
 *   - TTL ~8h (matches the NextAuth idle-timeout spirit).
 *
 * TRUST MODEL: the cookie is a *claim*. Every protected route MUST call
 * `requireGuardian()`, which re-validates against the DB that the person is
 * STILL an active Adult PrimaryCarer/AuthorisedGuardian of that family. The
 * cookie is never trusted blindly — it just avoids re-entering the PIN on
 * every page.
 */

export const GUARDIAN_COOKIE = "cc_guardian";
const TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function signingKey(): string {
  const base = process.env.NEXTAUTH_SECRET;
  if (!base) {
    // The entrypoint/launcher always sets NEXTAUTH_SECRET before the app runs.
    // Throwing here (rather than silently using a weak key) makes a misconfig
    // loud and obvious instead of producing forgeable sessions.
    throw new Error("NEXTAUTH_SECRET is not set — cannot sign guardian session");
  }
  return base + "|guardian-session-v1";
}

interface SessionPayload {
  pid: string; // personId of the signed-in carer
  fid: string; // familyId they signed in against
  iat: number; // issued-at (epoch ms)
}

type SessionClaims = SessionPayload;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function sign(payloadB64: string): string {
  return crypto
    .createHmac("sha256", signingKey())
    .update(payloadB64)
    .digest("base64url");
}

/** Build the cookie value to set after a successful PIN verify. */
export function signGuardianSession(args: {
  personId: string;
  familyId: string;
}): string {
  const payload: SessionPayload = {
    pid: args.personId,
    fid: args.familyId,
    iat: Date.now(),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Read + verify a guardian session from the incoming request cookies.
 * Returns the claims if the signature is valid and not expired, else null.
 */
export async function readGuardianSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  const raw = store.get(GUARDIAN_COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  // Constant-time-ish comparison of the signature.
  const expected = sign(payloadB64);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.pid !== "string" ||
    typeof payload.fid !== "string" ||
    typeof payload.iat !== "number"
  ) {
    return null;
  }
  if (Date.now() - payload.iat > TTL_MS) return null;
  return payload;
}

/** Options for setting the guardian cookie on a response. */
export function guardianCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  };
}

/**
 * The gate every /api/guardian/* and /guardian/* page calls.
 *
 * Reads the cookie, then re-validates against the DB that the person is STILL
 * an active Adult who is a PrimaryCarer or AuthorisedGuardian of the claimed
 * family. Returns the verified principal, or null.
 */
export async function getGuardian(): Promise<{
  personId: string;
  familyId: string;
  role: "PrimaryCarer" | "AuthorisedGuardian";
} | null> {
  const claims = await readGuardianSession();
  if (!claims) return null;

  const membership = await db.familyMember.findUnique({
    where: {
      familyId_personId: {
        familyId: claims.fid,
        personId: claims.pid,
      },
    },
    select: {
      role: true,
      person: {
        select: { id: true, personType: true, isActive: true },
      },
      family: { select: { isActive: true } },
    },
  });

  if (!membership) return null;
  if (!membership.person.isActive) return null;
  if (!membership.family.isActive) return null;
  if (membership.person.personType !== "Adult") return null;
  if (membership.role !== "PrimaryCarer" && membership.role !== "AuthorisedGuardian") {
    return null;
  }
  return {
    personId: claims.pid,
    familyId: claims.fid,
    role: membership.role,
  };
}

/**
 * Same as getGuardian but throws a structured "unauthorized" that API routes
 * can turn into a 401. Convenience for the common pattern.
 */
export async function requireGuardian(): Promise<{
  personId: string;
  familyId: string;
  role: "PrimaryCarer" | "AuthorisedGuardian";
}> {
  const g = await getGuardian();
  if (!g) {
    const err = new Error("unauthorized");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
  return g;
}

/** True only when the signed-in carer has PrimaryCarer edit rights on the family. */
export function canEditFamilyLocal(role: "PrimaryCarer" | "AuthorisedGuardian"): boolean {
  return role === "PrimaryCarer";
}
