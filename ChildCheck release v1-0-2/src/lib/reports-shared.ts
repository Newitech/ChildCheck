import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";

/**
 * Stage 10 reports — shared helpers.
 *
 * All report endpoints require Admin / PeopleManager / Security (the admin-side
 * role triad from the layout). Returns the user (or short-circuits with a 401
 * NextResponse) so handlers can destructure cleanly.
 */
export async function requireReportsUser(): Promise<
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> }
  | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const isAdminLike =
    user.roles.includes("Admin") ||
    user.roles.includes("PeopleManager") ||
    user.roles.includes("Security");
  if (!isAdminLike) {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, user };
}

/**
 * Parse a `?dateFrom=` or `?dateTo=` parameter as a Date. Returns null when
 * the parameter is missing or unparseable.
 */
export function parseDateParam(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Format a Date as a YYYY-MM-DD string (UTC). */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
