import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const SEVERITIES = new Set(["blocked", "flag"]);

const createSchema = z
  .object({
    childId: z.string().min(1).max(60).optional().nullable(),
    familyId: z.string().min(1).max(60).optional().nullable(),
    personId: z.string().min(1).max(60).optional().nullable(),
    collectorName: z.string().trim().min(1).max(160).optional().nullable(),
    collectorDescription: z.string().trim().max(2000).optional().nullable(),
    reason: z.string().trim().min(1).max(2000),
    severity: z
      .string()
      .refine((v) => SEVERITIES.has(v))
      .optional()
      .default("blocked"),
  })
  .superRefine((data, ctx) => {
    // Exactly one of childId/familyId must be set (scope of the block).
    const hasChild = !!data.childId;
    const hasFamily = !!data.familyId;
    if (hasChild === hasFamily) {
      ctx.addIssue({
        code: "custom",
        path: ["childId"],
        message:
          "Exactly one of childId or familyId must be set (the block scope).",
      });
    }
    // Exactly one of personId/collectorName must be set (who is blocked).
    const hasPerson = !!data.personId;
    const hasName = !!data.collectorName;
    if (hasPerson === hasName) {
      ctx.addIssue({
        code: "custom",
        path: ["personId"],
        message:
          "Exactly one of personId or collectorName must be set (the blocked collector).",
      });
    }
  });

/**
 * GET /api/admin/blacklist — list BlacklistEntry rows.
 *
 * Query params (all optional): childId, familyId, personId, severity.
 * When `familyId` is given, also returns child-specific entries for children
 * in that family (so the family-detail view shows the full picture).
 *
 * Returns entries with joined names so the UI can render without follow-up
 * fetches.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const childId = url.searchParams.get("childId");
  const familyId = url.searchParams.get("familyId");
  const personId = url.searchParams.get("personId");
  const severity = url.searchParams.get("severity");

  const where: { AND: Array<Record<string, unknown>> } = { AND: [] };

  if (childId) where.AND.push({ childId });
  if (personId) where.AND.push({ personId });
  if (severity) where.AND.push({ severity });
  if (familyId) {
    // Family-scoped query: include family-level entries + child-level entries
    // for any child in the family.
    const childMembers = await db.familyMember.findMany({
      where: { familyId, role: "Child" },
      select: { personId: true },
    });
    const childIds = childMembers.map((m) => m.personId);
    where.AND.push({
      OR: [
        { familyId },
        ...(childIds.length > 0 ? [{ childId: { in: childIds } }] : []),
      ],
    });
  }

  const entries = await db.blacklistEntry.findMany({
    where,
    include: {
      person: { select: { id: true, firstName: true, lastName: true } },
      family: { select: { id: true, familyName: true } },
      child: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    items: entries.map((e) => ({
      id: e.id,
      childId: e.childId,
      familyId: e.familyId,
      personId: e.personId,
      collectorName: e.collectorName,
      collectorDescription: e.collectorDescription,
      reason: e.reason,
      severity: e.severity,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      child: e.child
        ? { id: e.child.id, name: `${e.child.firstName} ${e.child.lastName}` }
        : null,
      family: e.family
        ? { id: e.family.id, familyName: e.family.familyName }
        : null,
      person: e.person
        ? { id: e.person.id, name: `${e.person.firstName} ${e.person.lastName}` }
        : null,
    })),
  });
}

/**
 * POST /api/admin/blacklist — create a BlacklistEntry.
 *
 * Validation:
 *   - Exactly one of childId/familyId set (the scope).
 *   - Exactly one of personId/collectorName set (the blocked collector).
 *   - severity defaults to "blocked" (hard stop).
 *
 * "blocked" = hard stop, never allow even if primary carer.
 * "flag"    = warn operator, supervisor override possible (Stage 8).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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

  // Validate foreign keys + scope invariants.
  if (p.childId) {
    const c = await db.person.findUnique({
      where: { id: p.childId },
      select: { personType: true },
    });
    if (!c) {
      return NextResponse.json(
        { error: "childId not found" },
        { status: 400 },
      );
    }
    if (c.personType !== "Child") {
      return NextResponse.json(
        { error: "childId must reference a Child Person" },
        { status: 400 },
      );
    }
  }
  if (p.familyId) {
    const f = await db.family.findUnique({
      where: { id: p.familyId },
      select: { id: true },
    });
    if (!f) {
      return NextResponse.json(
        { error: "familyId not found" },
        { status: 400 },
      );
    }
  }
  if (p.personId) {
    const p2 = await db.person.findUnique({
      where: { id: p.personId },
      select: { id: true },
    });
    if (!p2) {
      return NextResponse.json(
        { error: "personId not found" },
        { status: 400 },
      );
    }
  }

  // De-duplicate: reject an identical existing entry (same scope + same
  // collector + same reason).
  const existing = await db.blacklistEntry.findFirst({
    where: {
      childId: p.childId ?? null,
      familyId: p.familyId ?? null,
      personId: p.personId ?? null,
      collectorName: p.collectorName ?? null,
      severity: p.severity,
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "An identical blacklist entry already exists", id: existing.id },
      { status: 409 },
    );
  }

  const created = await db.blacklistEntry.create({
    data: {
      childId: p.childId ?? null,
      familyId: p.familyId ?? null,
      personId: p.personId ?? null,
      collectorName: p.collectorName ?? null,
      collectorDescription: p.collectorDescription ?? null,
      reason: p.reason,
      severity: p.severity,
      createdById: user.id,
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "blacklist.add",
    entity: "BlacklistEntry",
    entityId: created.id,
    details: {
      childId: created.childId,
      familyId: created.familyId,
      personId: created.personId,
      collectorName: created.collectorName,
      reason: created.reason,
      severity: created.severity,
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
