import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  youngerChildId: z.string().min(1).max(60),
  olderSiblingId: z.string().min(1).max(60),
  familyId: z.string().min(1).max(60),
  conditions: z.string().trim().max(2000).optional().nullable(),
});

/** 404 response used when the older_sibling_collect flag is OFF. */
function flagDisabled() {
  return NextResponse.json(
    {
      error:
        "older_sibling_collect feature flag is OFF — authorisations are not enabled",
    },
    { status: 404 },
  );
}

/**
 * GET /api/admin/older-sibling?youngerChildId=...
 *
 * Lists OlderSiblingAuthorisation rows for a given younger child. Flag-gated:
 * returns 404 if `older_sibling_collect` is OFF (DB rows are preserved but the
 * endpoint behaves as if the feature doesn't exist).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const enabled = await isFeatureEnabled("older_sibling_collect");
  if (!enabled) return flagDisabled();

  const url = new URL(req.url);
  const youngerChildId = url.searchParams.get("youngerChildId");
  const familyId = url.searchParams.get("familyId");

  const where: { AND: Array<Record<string, unknown>> } = { AND: [] };
  if (youngerChildId) where.AND.push({ youngerChildId });
  if (familyId) where.AND.push({ familyId });

  const rows = await db.olderSiblingAuthorisation.findMany({
    where,
    include: {
      youngerChild: {
        select: { id: true, firstName: true, lastName: true, isActive: true },
      },
      olderSibling: {
        select: { id: true, firstName: true, lastName: true, isActive: true, dateOfBirth: true },
      },
      family: { select: { id: true, familyName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      youngerChildId: r.youngerChildId,
      olderSiblingId: r.olderSiblingId,
      familyId: r.familyId,
      conditions: r.conditions,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      youngerChild: {
        id: r.youngerChild.id,
        name: `${r.youngerChild.firstName} ${r.youngerChild.lastName}`,
        isActive: r.youngerChild.isActive,
      },
      olderSibling: {
        id: r.olderSibling.id,
        name: `${r.olderSibling.firstName} ${r.olderSibling.lastName}`,
        isActive: r.olderSibling.isActive,
      },
      family: { id: r.family.id, familyName: r.family.familyName },
    })),
  });
}

/**
 * POST /api/admin/older-sibling — authorise an older sibling to collect a
 * younger sibling.
 *
 * Validation:
 *   - Both persons must be members of the same family.
 *   - The younger must be a Child.
 *   - The older must be a Child or Adult (typically an older Child).
 *   - No duplicate (youngerChildId, olderSiblingId) pair.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const enabled = await isFeatureEnabled("older_sibling_collect");
  if (!enabled) return flagDisabled();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  if (p.youngerChildId === p.olderSiblingId) {
    return NextResponse.json(
      { error: "younger and older must be different persons" },
      { status: 400 },
    );
  }

  // Validate the family exists.
  const family = await db.family.findUnique({
    where: { id: p.familyId },
    select: { id: true, familyName: true },
  });
  if (!family) {
    return NextResponse.json(
      { error: "familyId not found" },
      { status: 400 },
    );
  }

  // Both persons must be members of this family.
  const [youngerMembership, olderMembership] = await Promise.all([
    db.familyMember.findUnique({
      where: {
        familyId_personId: { familyId: p.familyId, personId: p.youngerChildId },
      },
      select: { id: true, role: true },
    }),
    db.familyMember.findUnique({
      where: {
        familyId_personId: { familyId: p.familyId, personId: p.olderSiblingId },
      },
      select: { id: true, role: true },
    }),
  ]);
  if (!youngerMembership) {
    return NextResponse.json(
      { error: "youngerChildId is not a member of the specified family" },
      { status: 400 },
    );
  }
  if (!olderMembership) {
    return NextResponse.json(
      { error: "olderSiblingId is not a member of the specified family" },
      { status: 400 },
    );
  }

  // Verify person types.
  const [youngerPerson, olderPerson] = await Promise.all([
    db.person.findUnique({
      where: { id: p.youngerChildId },
      select: { personType: true, firstName: true, lastName: true },
    }),
    db.person.findUnique({
      where: { id: p.olderSiblingId },
      select: { personType: true, firstName: true, lastName: true },
    }),
  ]);
  if (!youngerPerson || youngerPerson.personType !== "Child") {
    return NextResponse.json(
      { error: "youngerChildId must reference a Child Person" },
      { status: 400 },
    );
  }
  if (!olderPerson) {
    return NextResponse.json(
      { error: "olderSiblingId not found" },
      { status: 400 },
    );
  }

  // Duplicate guard (DB has @@unique([youngerChildId, olderSiblingId])).
  const dup = await db.olderSiblingAuthorisation.findUnique({
    where: {
      youngerChildId_olderSiblingId: {
        youngerChildId: p.youngerChildId,
        olderSiblingId: p.olderSiblingId,
      },
    },
    select: { id: true },
  });
  if (dup) {
    return NextResponse.json(
      {
        error: "An authorisation already exists for this sibling pair",
        id: dup.id,
      },
      { status: 409 },
    );
  }

  const created = await db.olderSiblingAuthorisation.create({
    data: {
      youngerChildId: p.youngerChildId,
      olderSiblingId: p.olderSiblingId,
      familyId: p.familyId,
      conditions: p.conditions ?? null,
      isActive: true,
      authorisedById: user.id,
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "older_sibling.add",
    entity: "OlderSiblingAuthorisation",
    entityId: created.id,
    details: {
      youngerChildId: created.youngerChildId,
      olderSiblingId: created.olderSiblingId,
      familyId: created.familyId,
      familyName: family.familyName,
      conditions: created.conditions,
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
