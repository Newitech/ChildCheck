import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getGuardian } from "@/lib/guardian-session";

export const dynamic = "force-dynamic";

const GENDERS = new Set(["Male", "Female", "Other"]);

/** Fields for creating a brand-new person via the guardian portal. */
const newPersonSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional().nullable(),
  lastName: z.string().trim().min(1).max(80),
  preferredName: z.string().trim().max(80).optional().nullable(),
  personType: z.enum(["Adult", "Child"]).default("Adult"),
  email: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  dateOfBirth: z.string().datetime().optional().nullable(),
  schoolGrade: z.string().trim().max(40).optional().nullable(),
  gender: z
    .string()
    .refine((v) => v == null || v === "" || GENDERS.has(v))
    .optional()
    .nullable(),
  allergies: z.string().max(2000).optional().nullable(),
  medicalNotes: z.string().max(4000).optional().nullable(),
  dietaryNotes: z.string().max(2000).optional().nullable(),
  emergencyContactName: z.string().trim().max(120).optional().nullable(),
  emergencyContactPhone: z.string().trim().max(60).optional().nullable(),
});

const addSchema = z
  .object({
    // Link an existing person by ID.
    personId: z.string().min(1).optional(),
    // Create a brand-new person with full details.
    newPerson: newPersonSchema.optional(),
    // Family-member role. When linking existing, only AuthorisedGuardian /
    // EmergencyContact are allowed. When creating new, PrimaryCarer / Child /
    // AuthorisedGuardian / EmergencyContact are allowed.
    role: z.enum([
      "PrimaryCarer",
      "Child",
      "AuthorisedGuardian",
      "EmergencyContact",
    ]),
  })
  .refine((d) => !!d.personId || !!d.newPerson, {
    message: "Either personId or newPerson is required.",
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
 * POST /api/guardian/family/members
 *
 * Two modes:
 *  1. Link existing: { personId, role } — role must be AuthorisedGuardian or
 *     EmergencyContact; person must be an active Adult.
 *  2. Create new: { newPerson: { ...full details }, role } — creates a new
 *     Person + FamilyMember in a transaction. role can be PrimaryCarer, Child,
 *     AuthorisedGuardian, or EmergencyContact. AuthorisedGuardian requires
 *     personType Adult.
 *
 * PrimaryCarer only.
 */
export async function POST(req: Request) {
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
  const { personId, newPerson, role } = parsed.data;
  const ip = clientIp(req);

  // ---- Mode 1: link existing person ----
  if (personId) {
    if (role !== "AuthorisedGuardian" && role !== "EmergencyContact") {
      return NextResponse.json(
        { error: "Linking an existing person is only allowed for AuthorisedGuardian or EmergencyContact roles." },
        { status: 400 },
      );
    }
    const person = await db.person.findUnique({
      where: { id: personId },
      select: { id: true, firstName: true, lastName: true, personType: true, isActive: true },
    });
    if (!person || !person.isActive) {
      return NextResponse.json(
        { error: "Person not found or inactive." },
        { status: 404 },
      );
    }
    if (person.personType !== "Adult") {
      return NextResponse.json(
        { error: "Only adults can be added as authorised guardians or emergency contacts." },
        { status: 400 },
      );
    }

    const existing = await db.familyMember.findUnique({
      where: { familyId_personId: { familyId: g.familyId, personId } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "This person is already a member of your family." },
        { status: 409 },
      );
    }

    await db.familyMember.create({
      data: { familyId: g.familyId, personId, role },
    });

    const addedName = `${person.firstName} ${person.lastName}`;
    await logAudit({
      actorPersonId: g.personId,
      action: "guardian.member_added",
      entity: "FamilyMember",
      entityId: `${g.familyId}:${personId}`,
      details: { role, addedName, mode: "link_existing" },
      ip,
    });

    return NextResponse.json({
      ok: true,
      member: { personId, role, name: addedName },
    });
  }

  // ---- Mode 2: create new person + link ----
  if (!newPerson) {
    return NextResponse.json(
      { error: "Either personId or newPerson is required." },
      { status: 400 },
    );
  }

  if (role === "AuthorisedGuardian" && newPerson.personType !== "Adult") {
    return NextResponse.json(
      { error: "AuthorisedGuardian requires an Adult person." },
      { status: 400 },
    );
  }

  const result = await db.$transaction(async (tx) => {
    const created = await tx.person.create({
      data: {
        firstName: newPerson.firstName,
        middleName: nullIfEmpty(newPerson.middleName),
        lastName: newPerson.lastName,
        preferredName: nullIfEmpty(newPerson.preferredName),
        personType: newPerson.personType,
        email: nullIfEmpty(newPerson.email),
        phone: nullIfEmpty(newPerson.phone),
        dateOfBirth: newPerson.dateOfBirth ? new Date(newPerson.dateOfBirth) : null,
        schoolGrade: nullIfEmpty(newPerson.schoolGrade),
        gender: !newPerson.gender || newPerson.gender === "" ? null : newPerson.gender,
        allergies: nullIfEmpty(newPerson.allergies),
        medicalNotes: nullIfEmpty(newPerson.medicalNotes),
        dietaryNotes: nullIfEmpty(newPerson.dietaryNotes),
        emergencyContactName: nullIfEmpty(newPerson.emergencyContactName),
        emergencyContactPhone: nullIfEmpty(newPerson.emergencyContactPhone),
        isVisitor: false,
        isActive: true,
      },
    });

    await tx.familyMember.create({
      data: { familyId: g.familyId, personId: created.id, role },
    });

    return created;
  });

  const addedName = `${result.firstName} ${result.lastName}`;
  await logAudit({
    actorPersonId: g.personId,
    action: "guardian.member_added",
    entity: "FamilyMember",
    entityId: `${g.familyId}:${result.id}`,
    details: { role, addedName, mode: "create_new", personId: result.id },
    ip,
  });

  return NextResponse.json({
    ok: true,
    member: { personId: result.id, role, name: addedName },
  });
}
