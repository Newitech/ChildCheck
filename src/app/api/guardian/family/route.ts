import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getGuardian } from "@/lib/guardian-session";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  familyName: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(4000).optional().nullable(),
});

function nullIfEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

/**
 * GET /api/guardian/family
 *
 * Returns the signed-in carer's family with full member detail (including
 * medical fields for children — they ARE the carer). Scoped to the carer's own
 * family; no familyId in the URL (taken from the verified session).
 */
export async function GET(req: Request) {
  const g = await getGuardian();
  if (!g) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const family = await db.family.findUnique({
    where: { id: g.familyId, isActive: true },
    include: {
      members: {
        include: {
          person: {
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              preferredName: true,
              personType: true,
              email: true,
              phone: true,
              dateOfBirth: true,
              schoolGrade: true,
              gender: true,
              allergies: true,
              medicalNotes: true,
              dietaryNotes: true,
              emergencyContactName: true,
              emergencyContactPhone: true,
              photoPath: true,
              isVisitor: true,
              isActive: true,
              pinHash: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!family) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  return NextResponse.json({
    id: family.id,
    familyName: family.familyName,
    notes: family.notes,
    // The signed-in carer's own person id + role (so the UI knows if they
    // can edit — PrimaryCarer only).
    me: { personId: g.personId, role: g.role, ip },
    members: family.members.map((m) => ({
      id: m.id,
      role: m.role,
      person: {
        id: m.person.id,
        firstName: m.person.firstName,
        middleName: m.person.middleName,
        lastName: m.person.lastName,
        preferredName: m.person.preferredName,
        personType: m.person.personType,
        email: m.person.email,
        phone: m.person.phone,
        dateOfBirth: m.person.dateOfBirth?.toISOString() ?? null,
        schoolGrade: m.person.schoolGrade,
        gender: m.person.gender,
        allergies: m.person.allergies,
        medicalNotes: m.person.medicalNotes,
        dietaryNotes: m.person.dietaryNotes,
        emergencyContactName: m.person.emergencyContactName,
        emergencyContactPhone: m.person.emergencyContactPhone,
        hasPhoto: !!m.person.photoPath,
        isVisitor: m.person.isVisitor,
        isActive: m.person.isActive,
        // True only when this member IS the signed-in carer (so the UI can show
        // the "Change my PIN" control on their own row).
        isMe: m.person.id === g.personId,
        // Whether this member has a PIN set (for display; never the hash).
        hasPin: !!m.person.pinHash,
      },
    })),
  });
}

/**
 * PUT /api/guardian/family
 *
 * Update family-level fields (familyName, notes). PrimaryCarer only.
 */
export async function PUT(req: Request) {
  const g = await getGuardian();
  if (!g) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (g.role !== "PrimaryCarer") {
    return NextResponse.json(
      { error: "Only the primary carer can edit family details." },
      { status: 403 },
    );
  }

  const existing = await db.family.findUnique({
    where: { id: g.familyId },
    select: { familyName: true, notes: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  const data: Record<string, unknown> = {};
  const changed: Record<string, unknown> = {};

  if (p.familyName !== undefined && p.familyName !== existing.familyName) {
    data.familyName = p.familyName;
    changed.familyName = p.familyName;
  }
  if (p.notes !== undefined) {
    const v = nullIfEmpty(p.notes);
    if (v !== existing.notes) {
      data.notes = v;
      changed.notes = v;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, changed: {} });
  }

  await db.family.update({ where: { id: g.familyId }, data });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await logAudit({
    actorPersonId: g.personId,
    action: "guardian.family_update",
    entity: "Family",
    entityId: g.familyId,
    details: changed,
    ip,
  });

  return NextResponse.json({ ok: true, changed });
}
