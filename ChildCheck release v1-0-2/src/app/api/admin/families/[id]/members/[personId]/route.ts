import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** DELETE /api/admin/families/[id]/members/[personId] — remove a membership. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; personId: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, personId } = await ctx.params;

  const existing = await db.familyMember.findUnique({
    where: { familyId_personId: { familyId: id, personId } },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Pull the family + person names so the audit entry is human-readable.
  const [family, person] = await Promise.all([
    db.family.findUnique({ where: { id }, select: { familyName: true } }),
    db.person.findUnique({
      where: { id: personId },
      select: { firstName: true, lastName: true },
    }),
  ]);

  await db.familyMember.delete({
    where: { familyId_personId: { familyId: id, personId } },
  });

  // Stage 4: dedicated audit action when removing an AuthorisedGuardian.
  const action =
    existing.role === "AuthorisedGuardian"
      ? "family.guardian.remove"
      : "family.member.remove";

  await logAudit({
    actorUserId: user.id,
    action,
    entity: "FamilyMember",
    entityId: existing.id,
    details: {
      familyId: id,
      familyName: family?.familyName ?? null,
      personId,
      personName: person
        ? `${person.firstName} ${person.lastName}`
        : null,
      role: existing.role,
    },
  });

  return NextResponse.json({ ok: true });
}
