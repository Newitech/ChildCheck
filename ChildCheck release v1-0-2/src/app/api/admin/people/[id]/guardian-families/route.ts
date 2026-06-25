import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/people/[id]/guardian-families — for an Adult Person, return
 * every family where they are an AuthorisedGuardian. Used by the person
 * detail page's "Guardian for families" section.
 *
 * Stage 4 — guardians have sign-in/out rights but no edit rights. A guardian
 * can be linked to multiple families (e.g. a grandparent with grandchildren
 * across two households).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const person = await db.person.findUnique({
    where: { id },
    select: { id: true, personType: true, firstName: true, lastName: true },
  });
  if (!person) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }
  if (person.personType !== "Adult") {
    return NextResponse.json({
      personId: person.id,
      personName: `${person.firstName} ${person.lastName}`,
      families: [],
      note: "Only Adult persons can be AuthorisedGuardians.",
    });
  }

  const memberships = await db.familyMember.findMany({
    where: { personId: id, role: "AuthorisedGuardian" },
    include: {
      family: {
        select: {
          id: true,
          familyName: true,
          isActive: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    personId: person.id,
    personName: `${person.firstName} ${person.lastName}`,
    families: memberships.map((m) => ({
      membershipId: m.id,
      familyId: m.family.id,
      familyName: m.family.familyName,
      familyActive: m.family.isActive,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
