import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ROLES = new Set([
  "PrimaryCarer",
  "Child",
  "AuthorisedGuardian",
  "EmergencyContact",
]);

const addSchema = z.object({
  personId: z.string().min(1).max(60),
  role: z.string().refine((v) => ROLES.has(v), {
    message: "role must be PrimaryCarer | Child | AuthorisedGuardian | EmergencyContact",
  }),
});

/** POST /api/admin/families/[id]/members — add a person to a family. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const family = await db.family.findUnique({ where: { id } });
  if (!family) {
    return NextResponse.json({ error: "family not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { personId, role } = parsed.data;

  const person = await db.person.findUnique({ where: { id: personId } });
  if (!person) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }

  // Stage 4: AuthorisedGuardian MUST be an Adult — guardians have sign-in/out
  // rights but no edit rights; a child cannot be a guardian of another child.
  if (role === "AuthorisedGuardian" && person.personType !== "Adult") {
    return NextResponse.json(
      {
        error: "AuthorisedGuardian role requires an Adult person",
      },
      { status: 400 },
    );
  }

  const existing = await db.familyMember.findUnique({
    where: { familyId_personId: { familyId: id, personId } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "person is already a member of this family", existingRole: existing.role },
      { status: 409 },
    );
  }

  const membership = await db.familyMember.create({
    data: { familyId: id, personId, role },
  });

  // Stage 4: dedicated audit action when adding an AuthorisedGuardian, so
  // child-safety events are easy to filter from the audit log.
  const action =
    role === "AuthorisedGuardian" ? "family.guardian.add" : "family.member.add";

  await logAudit({
    actorUserId: user.id,
    action,
    entity: "FamilyMember",
    entityId: membership.id,
    details: {
      familyId: id,
      familyName: family.familyName,
      personId,
      personName: `${person.firstName} ${person.lastName}`,
      role,
    },
  });

  return NextResponse.json({ id: membership.id, role }, { status: 201 });
}
