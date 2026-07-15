import { NextResponse } from "next/server";

import { GUARDIAN_COOKIE, guardianCookieOptions } from "@/lib/guardian-session";

export const dynamic = "force-dynamic";

/**
 * POST /api/guardian/signout
 *
 * Clears the guardian session cookie. Always returns 200 (idempotent — calling
 * it when already signed out is fine).
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Overwrite with an empty value + immediate expiry.
  res.cookies.set(GUARDIAN_COOKIE, "", {
    ...guardianCookieOptions(),
    maxAge: 0,
  });
  return res;
}
