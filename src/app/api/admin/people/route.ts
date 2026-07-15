import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { toPersonListDTO } from "@/lib/people";
import { hashPin } from "@/lib/password";
import { setPersonRoles, RolesRequireLoginError } from "@/lib/person-roles";

export const dynamic = "force-dynamic";

const PERSON_TYPES = new Set(["Adult", "Child"]);
const GENDERS = new Set(["Male", "Female", "Other"]);

const createSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional().nullable(),
  lastName: z.string().trim().min(1).max(80),
  preferredName: z.string().trim().min(1).max(80).optional().nullable(),
  personType: z.enum(["Adult", "Child"]).default("Adult"),
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
  isVisitor: z.boolean().default(false),
  // Optional one-shot: set an initial guardian PIN + staff roles, and/or link
  // the new person to a family with a membership role.
  pin: z
    .string()
    .regex(/^\d{4,6}$/)
    .optional()
    .nullable(),
  roles: z.array(z.string()).optional(),
  familyId: z.string().max(60).optional().nullable(),
  familyRole: z
    .enum(["PrimaryCarer", "AuthorisedGuardian", "Child"])
    .optional()
    .nullable(),
});

function nullIfEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

/**
 * GET /api/admin/people — paginated, filtered list.
 *
 * Query params: q (search firstName/lastName/email/phone),
 *               personType ("Adult" | "Child"),
 *               isVisitor ("true" | "false"),
 *               page (1-based, default 1),
 *               pageSize (default 20, max 100).
 *
 * Returns LIST-safe DTOs — medical fields are NEVER included.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const personType = url.searchParams.get("personType");
  const visitorParam = url.searchParams.get("isVisitor");
  const role = url.searchParams.get("role");
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20),
  );

  const wwccEnabled = await isFeatureEnabled("working_with_children_tracking");

  const where: {
    AND: Array<Record<string, unknown>>;
  } = { AND: [] };

  if (!includeInactive) where.AND.push({ isActive: true });

  if (personType && PERSON_TYPES.has(personType)) {
    where.AND.push({ personType });
  }

  if (visitorParam === "true") where.AND.push({ isVisitor: true });
  if (visitorParam === "false") where.AND.push({ isVisitor: false });

  // Filter by assigned PersonRole (powers the Users-page role-group view).
  if (role) where.AND.push({ roles: { some: { role } } });

  if (q) {
    where.AND.push({
      OR: [
        { firstName: { contains: q } },
        { middleName: { contains: q } },
        { lastName: { contains: q } },
        { preferredName: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
      ],
    });
  }

  const [total, rows] = await Promise.all([
    db.person.count({ where }),
    db.person.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        familyMemberships: true,
        ...(wwccEnabled ? { wwccards: { select: { status: true } } } : {}),
      },
    }),
  ]);

  const items = await Promise.all(
    rows.map((r) => toPersonListDTO(r, wwccEnabled)),
  );

  return NextResponse.json({ items, total, page, pageSize });
}

/**
 * POST /api/admin/people — create a new Person.
 * Requires manage_people permission.
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

  // Child validation: DOB strongly recommended but not required.
  const created = await db.person.create({
    data: {
      firstName: p.firstName,
      middleName: nullIfEmpty(p.middleName),
      lastName: p.lastName,
      preferredName: nullIfEmpty(p.preferredName),
      personType: p.personType,
      email: nullIfEmpty(p.email),
      phone: nullIfEmpty(p.phone),
      dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
      schoolGrade: nullIfEmpty(p.schoolGrade),
      gender: p.gender === null ? null : (p.gender ?? null),
      allergies: nullIfEmpty(p.allergies),
      medicalNotes: nullIfEmpty(p.medicalNotes),
      dietaryNotes: nullIfEmpty(p.dietaryNotes),
      emergencyContactName: nullIfEmpty(p.emergencyContactName),
      emergencyContactPhone: nullIfEmpty(p.emergencyContactPhone),
      isVisitor: p.isVisitor,
      // Optional initial guardian PIN (lives on Person).
      pinHash: p.pin ? await hashPin(p.pin) : undefined,
      createdById: user.id,
    },
  });

  // Optional: assign staff roles (enforces Admin/PM-requires-login). A newly
  // created person has no login yet, so Admin/PM will throw here.
  if (p.roles && p.roles.length > 0) {
    try {
      await setPersonRoles({
        personId: created.id,
        roles: p.roles,
        actorUserId: user.id,
      });
    } catch (e) {
      if (e instanceof RolesRequireLoginError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
  }

  // Optional: link to a family with a membership role.
  if (p.familyId && p.familyRole) {
    const family = await db.family.findUnique({ where: { id: p.familyId } });
    if (!family) {
      return NextResponse.json(
        { error: "family not found" },
        { status: 400 },
      );
    }
    if (p.familyRole === "AuthorisedGuardian" && created.personType !== "Adult") {
      return NextResponse.json(
        { error: "AuthorisedGuardian requires an Adult person" },
        { status: 400 },
      );
    }
    await db.familyMember.create({
      data: { familyId: p.familyId, personId: created.id, role: p.familyRole },
    });
    await logAudit({
      actorUserId: user.id,
      action: "family.member.add",
      entity: "FamilyMember",
      entityId: created.id,
      details: {
        familyId: p.familyId,
        familyName: family.familyName,
        personId: created.id,
        personName: `${created.firstName} ${created.lastName}`,
        role: p.familyRole,
      },
    });
  }

  await logAudit({
    actorUserId: user.id,
    action: "person.create",
    entity: "Person",
    entityId: created.id,
    details: {
      firstName: created.firstName,
      lastName: created.lastName,
      personType: created.personType,
      isVisitor: created.isVisitor,
      withPin: !!p.pin,
      withRoles: p.roles?.length ?? 0,
      withFamily: !!p.familyId,
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
