import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/kiosk/search?q=<query>
 *
 * Public kiosk family search (Stage 6).
 *
 * Behaviour:
 *   - If the `kiosk_requires_login` flag is ON, the request MUST carry an
 *     authenticated session with role Kiosk / Admin / Security. Otherwise 401.
 *   - In open mode (flag OFF), the endpoint is public but rate-limited to
 *     30 requests / minute / IP to prevent enumeration.
 *   - Minimum query length: 2 chars (after trim). Empty / 1-char → empty list.
 *   - Response is deliberately minimal — see KioskSearchResultItem. NO
 *     medical / contact / photo / address fields. Only a boolean `hasAlerts`
 *     so the kiosk can show a badge without leaking the underlying data.
 *   - Results capped at 20.
 *   - If `audit_log_detailed` is ON, each search is written to AuditLog with
 *     action "kiosk.search" and details { q, resultCount, ip }.
 */

export interface KioskSearchResultItem {
  familyId: string;
  familyName: string;
  primaryCarers: { firstName: string; lastName: string }[];
  childCount: number;
  hasAlerts: boolean;
}

export interface KioskSearchResponse {
  items: KioskSearchResultItem[];
}

// 30 req / min / IP. Generous enough for a busy kiosk but blocks scripts.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RESULTS_LIMIT = 20;
const MIN_QUERY_LEN = 2;

export async function GET(req: Request) {
  const ip = getClientIp(req);

  // -----------------------------------------------------------------------
  // Rate limit (applies in both modes — even authed kiosks shouldn't slam).
  // -----------------------------------------------------------------------
  const rl = rateLimit(`kiosk.search:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rl.ok) {
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
  // Auth gate: if kiosk_requires_login, require kiosk-authed session.
  // -----------------------------------------------------------------------
  const flags = await getFeatureFlags();
  const requiresLogin = flags.kiosk_requires_login === true;
  let actorUserId: string | null = null;
  if (requiresLogin) {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const ok =
      hasPermission(user.roles, "kiosk_operate") ||
      user.roles.includes("Admin") ||
      user.roles.includes("Security");
    if (!ok) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    actorUserId = user.id;
  }

  // -----------------------------------------------------------------------
  // Parse + validate query.
  // -----------------------------------------------------------------------
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY_LEN) {
    return NextResponse.json({ items: [] });
  }

  // -----------------------------------------------------------------------
  // Search across:
  //   - Family.familyName
  //   - member Person.firstName / lastName / email / phone
  // SQLite LIKE is case-insensitive for ASCII, so `contains` (which compiles
  // to LIKE) is sufficient. We don't use `mode: "insensitive"` because SQLite
  // doesn't support it (Prisma throws).
  // -----------------------------------------------------------------------
  const families = await db.family.findMany({
    where: {
      isActive: true,
      OR: [
        { familyName: { contains: q } },
        {
          members: {
            some: {
              person: {
                OR: [
                  { firstName: { contains: q } },
                  { lastName: { contains: q } },
                  { email: { contains: q } },
                  { phone: { contains: q } },
                ],
              },
            },
          },
        },
      ],
    },
    orderBy: [{ familyName: "asc" }],
    take: RESULTS_LIMIT,
    include: {
      members: {
        include: {
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              personType: true,
              allergies: true,
              medicalNotes: true,
            },
          },
        },
      },
      blacklistEntries: {
        where: { familyId: { not: null } },
        select: { id: true },
      },
    },
  });

  const items: KioskSearchResultItem[] = families.map((f) => {
    const carers = f.members
      .filter((m) => m.role === "PrimaryCarer" && m.person.personType === "Adult")
      .map((m) => ({ firstName: m.person.firstName, lastName: m.person.lastName }));
    const childMembers = f.members.filter((m) => m.role === "Child");
    const hasAlerts =
      childMembers.some(
        (m) =>
          (m.person.allergies && m.person.allergies.trim().length > 0) ||
          (m.person.medicalNotes && m.person.medicalNotes.trim().length > 0),
      ) || f.blacklistEntries.length > 0;
    return {
      familyId: f.id,
      familyName: f.familyName,
      primaryCarers: carers,
      childCount: childMembers.length,
      hasAlerts,
    };
  });

  // -----------------------------------------------------------------------
  // Audit (only if detailed audit is enabled — avoids spamming).
  // -----------------------------------------------------------------------
  if (flags.audit_log_detailed) {
    await logAudit({
      actorUserId,
      action: "kiosk.search",
      entity: "Family",
      details: { q, resultCount: items.length },
      ip,
    });
  }

  return NextResponse.json({ items });
}
