import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getGuardian } from "@/lib/guardian-session";

export const dynamic = "force-dynamic";

const GENDERS = new Set(["Male", "Female", "Other"]);

/**
 * Subset of the admin person-update schema. Excludes personType, isActive,
 * isVisitor — those are admin-only.
 */
const updateSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  middleName: z.string().trim().max(80).optional().nullable(),
  lastName: z.string().trim().min(1).max(80).optional(),
  preferredName: z.string().trim().min(0).max(80).optional().nullable(),
  email: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  dateOfBirth: z.string().datetime().optional().nullable(),
  schoolGrade: z.string().trim().max(40).optional().nullable(),
  gender: z
    .string()
    .refine((v) => v === null || GENDERS.has(v))
    .optional()
    .nullable(),
  allergies: z.string().max(2000).optional().nullable(),
  medicalNotes: z.string().max(4000).optional().nullable(),
  dietaryNotes: z.string().max(2000).optional().nullable(),
  emergencyContactName: z.string().trim().max(120).optional().nullable(),
  emergencyContactPhone: z.string().trim().max(60).optional().nullable(),
});

function nullIfEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/**
 * PUT /api/guardian/people/[personId]
 *
 * Update a person who is a member of the carer's family. PrimaryCarer only
 * (AuthorisedGuardians have read-only access). Does not allow changing
 * personType, isActive, or isVisitor.
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ personId: string }> },
) {
  const g = await getGuardian();
  if (!g) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (g.role !== "PrimaryCarer") {
    return NextResponse.json(
      { error: "Only the primary carer can edit family member details." },
      { status: 403 },
    );
  }
  const { personId } = await ctx.params;

  // Verify the person is a member of this carer's family.
  const membership = await db.familyMember.findUnique({
    where: { familyId_personId: { familyId: g.familyId, personId } },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json(
      { error: "Person is not a member of your family." },
      { status: 404 },
    );
  }

  const existing = await db.person.findUnique({ where: { id: personId } });
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

  if (p.firstName !== undefined && p.firstName !== existing.firstName) {
    data.firstName = p.firstName;
    changed.firstName = p.firstName;
  }
  if (p.middleName !== undefined) {
    const v = nullIfEmpty(p.middleName);
    if (v !== existing.middleName) { data.middleName = v; changed.middleName = v; }
  }
  if (p.lastName !== undefined && p.lastName !== existing.lastName) {
    data.lastName = p.lastName;
    changed.lastName = p.lastName;
  }
  if (p.preferredName !== undefined) {
    const v = nullIfEmpty(p.preferredName);
    if (v !== existing.preferredName) { data.preferredName = v; changed.preferredName = v; }
  }
  if (p.email !== undefined) {
    const v = nullIfEmpty(p.email);
    if (v !== existing.email) { data.email = v; changed.email = v; }
  }
  if (p.phone !== undefined) {
    const v = nullIfEmpty(p.phone);
    if (v !== existing.phone) { data.phone = v; changed.phone = v; }
  }
  if (p.dateOfBirth !== undefined) {
    const v = p.dateOfBirth ? new Date(p.dateOfBirth) : null;
    const existingIso = existing.dateOfBirth?.toISOString() ?? null;
    const newIso = v?.toISOString() ?? null;
    if (newIso !== existingIso) { data.dateOfBirth = v; changed.dateOfBirth = newIso; }
  }
  if (p.schoolGrade !== undefined) {
    const v = nullIfEmpty(p.schoolGrade);
    if (v !== existing.schoolGrade) { data.schoolGrade = v; changed.schoolGrade = v; }
  }
  if (p.gender !== undefined) {
    const v = p.gender === null ? null : (p.gender ?? null);
    if (v !== existing.gender) { data.gender = v; changed.gender = v; }
  }
  if (p.allergies !== undefined) {
    const v = nullIfEmpty(p.allergies);
    if (v !== existing.allergies) { data.allergies = v; changed.allergies = v; }
  }
  if (p.medicalNotes !== undefined) {
    const v = nullIfEmpty(p.medicalNotes);
    if (v !== existing.medicalNotes) { data.medicalNotes = v; changed.medicalNotes = v; }
  }
  if (p.dietaryNotes !== undefined) {
    const v = nullIfEmpty(p.dietaryNotes);
    if (v !== existing.dietaryNotes) { data.dietaryNotes = v; changed.dietaryNotes = v; }
  }
  if (p.emergencyContactName !== undefined) {
    const v = nullIfEmpty(p.emergencyContactName);
    if (v !== existing.emergencyContactName) { data.emergencyContactName = v; changed.emergencyContactName = v; }
  }
  if (p.emergencyContactPhone !== undefined) {
    const v = nullIfEmpty(p.emergencyContactPhone);
    if (v !== existing.emergencyContactPhone) { data.emergencyContactPhone = v; changed.emergencyContactPhone = v; }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, changed: {} });
  }

  await db.person.update({ where: { id: personId }, data });

  const ip = clientIp(req);
  await logAudit({
    actorPersonId: g.personId,
    action: "guardian.person_update",
    entity: "Person",
    entityId: personId,
    details: changed,
    ip,
  });

  return NextResponse.json({ ok: true, changed });
}
