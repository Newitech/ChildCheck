import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getGuardian } from "@/lib/guardian-session";

export const dynamic = "force-dynamic";

/**
 * GET /api/guardian/people/search?q=...
 *
 * Searches for active Adults by name/email/phone. Used by the guardian
 * "add member" dialog to find an existing person to link as an authorised
 * guardian or emergency contact. Returns at most 20 results.
 *
 * Guardian-session only (any signed-in carer can search).
 */
export async function GET(req: Request) {
  const g = await getGuardian();
  if (!g) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ items: [] });
  }

  const people = await db.person.findMany({
    where: {
      personType: "Adult",
      isActive: true,
      OR: [
        { firstName: { contains: q } },
        { lastName: { contains: q } },
        { preferredName: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
    take: 20,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json({ items: people });
}
