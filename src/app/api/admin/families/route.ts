import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const GENDERS = new Set(["Male", "Female", "Other"]);

const createSchema = z.object({
  familyName: z.string().trim().min(1).max(120),
  notes: z.string().max(4000).optional().nullable(),
  memberIds: z.array(z.string().min(1).max(60)).optional(),
  // Inline creation: brand-new people created + linked as members in one call.
  newMembers: z
    .array(
      z.object({
        firstName: z.string().trim().min(1).max(80),
        middleName: z.string().trim().max(80).optional().nullable(),
        lastName: z.string().trim().min(1).max(80),
        preferredName: z.string().trim().max(80).optional().nullable(),
        personType: z.enum(["Adult", "Child"]).default("Adult"),
        phone: z.string().trim().max(60).optional().nullable(),
        email: z.string().trim().max(160).optional().nullable(),
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
        isVisitor: z.boolean().default(false),
      }),
    )
    .optional(),
});

function nullIfEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

/**
 * GET /api/admin/families — paginated, filtered list.
 * Query: q (search familyName or member names), page, pageSize.
 * Returns families with member count + primary carer names.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20),
  );

  const where: { AND: Array<Record<string, unknown>> } = { AND: [] };
  if (!includeInactive) where.AND.push({ isActive: true });

  if (q) {
    where.AND.push({
      OR: [
        { familyName: { contains: q } },
        {
          members: {
            some: {
              person: {
                OR: [
                  { firstName: { contains: q } },
                  { lastName: { contains: q } },
                ],
              },
            },
          },
        },
      ],
    });
  }

  const [total, rows] = await Promise.all([
    db.family.count({ where }),
    db.family.findMany({
      where,
      orderBy: [{ familyName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        members: {
          include: {
            person: {
              select: { id: true, firstName: true, lastName: true, personType: true },
            },
          },
        },
      },
    }),
  ]);

  const items = rows.map((f) => {
    const carers = f.members
      .filter((m) => m.role === "PrimaryCarer")
      .map((m) => `${m.person.firstName} ${m.person.lastName}`);
    const childrenCount = f.members.filter((m) => m.role === "Child").length;
    return {
      id: f.id,
      familyName: f.familyName,
      isActive: f.isActive,
      memberCount: f.members.length,
      primaryCarers: carers,
      childrenCount,
      notes: f.notes,
    };
  });

  return NextResponse.json({ items, total, page, pageSize });
}

/** POST /api/admin/families — create a family + optional members. */
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

  // Validate memberIds exist + derive role from personType for default membership.
  let memberRows: { id: string; personType: string }[] = [];
  if (p.memberIds && p.memberIds.length > 0) {
    const uniqIds = Array.from(new Set(p.memberIds));
    memberRows = await db.person.findMany({
      where: { id: { in: uniqIds }, isActive: true },
      select: { id: true, personType: true },
    });
    if (memberRows.length !== uniqIds.length) {
      return NextResponse.json(
        { error: "one or more memberIds not found or inactive" },
        { status: 400 },
      );
    }
  }

  const created = await db.$transaction(async (tx) => {
    // Create new people first (so their ids are available for linking).
    const newMemberRows: { id: string; personType: string }[] = [];
    for (const nm of p.newMembers ?? []) {
      const np = await tx.person.create({
        data: {
          firstName: nm.firstName,
          middleName: nullIfEmpty(nm.middleName),
          lastName: nm.lastName,
          preferredName: nullIfEmpty(nm.preferredName),
          personType: nm.personType,
          phone: nullIfEmpty(nm.phone),
          email: nullIfEmpty(nm.email),
          dateOfBirth: nm.dateOfBirth ? new Date(nm.dateOfBirth) : null,
          schoolGrade: nullIfEmpty(nm.schoolGrade),
          gender: !nm.gender || nm.gender === "" ? null : nm.gender,
          allergies: nullIfEmpty(nm.allergies),
          medicalNotes: nullIfEmpty(nm.medicalNotes),
          dietaryNotes: nullIfEmpty(nm.dietaryNotes),
          emergencyContactName: nullIfEmpty(nm.emergencyContactName),
          emergencyContactPhone: nullIfEmpty(nm.emergencyContactPhone),
          isVisitor: nm.isVisitor,
          isActive: true,
          createdById: user.id,
        },
      });
      newMemberRows.push({ id: np.id, personType: np.personType });
    }

    const allMembers = [...memberRows, ...newMemberRows];

    const family = await tx.family.create({
      data: {
        familyName: p.familyName,
        notes: nullIfEmpty(p.notes),
        createdById: user.id,
        members:
          allMembers.length > 0
            ? {
                create: allMembers.map((m) => ({
                  personId: m.id,
                  role: m.personType === "Child" ? "Child" : "PrimaryCarer",
                })),
              }
            : undefined,
      },
      include: { members: true },
    });

    return { family, newMemberRows };
  });

  await logAudit({
    actorUserId: user.id,
    action: "family.create",
    entity: "Family",
    entityId: created.family.id,
    details: {
      familyName: created.family.familyName,
      memberIds: memberRows.map((m) => m.id),
      newMemberIds: created.newMemberRows.map((m) => m.id),
    },
  });

  return NextResponse.json({ id: created.family.id }, { status: 201 });
}
