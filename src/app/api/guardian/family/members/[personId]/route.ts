import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getGuardian } from "@/lib/guardian-session";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/guardian/family/members/[personId]
 *
 * Remove a member from the carer's family. PrimaryCarer only.
 * Cannot remove self, and cannot remove the last PrimaryCarer.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ personId: string }> },
) {
  const g = await getGuardian();
  if (!g) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (g.role !== "PrimaryCarer") {
    return NextResponse.json(
      { error: "Only the primary carer can manage family members." },
      { status: 403 },
    );
  }
  const { personId } = await ctx.params;

  // Cannot remove self.
  if (personId === g.personId) {
    return NextResponse.json(
      { error: "You cannot remove yourself from the family." },
      { status: 400 },
    );
  }

  // Verify the membership exists.
  const membership = await db.familyMember.findUnique({
    where: { familyId_personId: { familyId: g.familyId, personId } },
    select: { id: true, role: true, person: { select: { firstName: true, lastName: true } } },
  });
  if (!membership) {
    return NextResponse.json(
      { error: "Person is not a member of your family." },
      { status: 404 },
    );
  }

  // Cannot remove the last PrimaryCarer.
  if (membership.role === "PrimaryCarer") {
    const primaryCount = await db.familyMember.count({
      where: {
        familyId: g.familyId,
        role: "PrimaryCarer",
      },
    });
    if (primaryCount <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last primary carer from the family. Ask an admin for help." },
        { status: 400 },
      );
    }
  }

  await db.familyMember.delete({
    where: { familyId_personId: { familyId: g.familyId, personId } },
  });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await logAudit({
    actorPersonId: g.personId,
    action: "guardian.member_removed",
    entity: "FamilyMember",
    entityId: `${g.familyId}:${personId}`,
    details: {
      removedRole: membership.role,
      removedName: `${membership.person.firstName} ${membership.person.lastName}`,
    },
    ip,
  });

  return NextResponse.json({ ok: true });
}
