import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/families/[id]/guardians — list AuthorisedGuardian members of
 * a family with a Person summary. Used by the family detail page's
 * "Authorised Guardians" section.
 *
 * Stage 4 — AuthorisedGuardians have sign-in/out rights but NO edit rights
 * on the family's data. The UI surfaces this distinction explicitly.
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

  const family = await db.family.findUnique({
    where: { id },
    select: { id: true, familyName: true },
  });
  if (!family) {
    return NextResponse.json({ error: "family not found" }, { status: 404 });
  }

  const memberships = await db.familyMember.findMany({
    where: { familyId: id, role: "AuthorisedGuardian" },
    include: {
      person: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          personType: true,
          email: true,
          phone: true,
          photoPath: true,
          isVisitor: true,
          isActive: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    familyId: family.id,
    familyName: family.familyName,
    guardians: memberships.map((m) => ({
      membershipId: m.id,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      person: {
        id: m.person.id,
        firstName: m.person.firstName,
        lastName: m.person.lastName,
        preferredName: m.person.preferredName,
        personType: m.person.personType,
        email: m.person.email,
        phone: m.person.phone,
        hasPhoto: !!m.person.photoPath,
        isVisitor: m.person.isVisitor,
        isActive: m.person.isActive,
      },
    })),
  });
}
