import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  familyName: z.string().trim().min(1).max(120),
  notes: z.string().max(4000).optional().nullable(),
  memberIds: z.array(z.string().min(1).max(60)).optional(),
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

  const created = await db.family.create({
    data: {
      familyName: p.familyName,
      notes: nullIfEmpty(p.notes),
      createdById: user.id,
      members:
        memberRows.length > 0
          ? {
              create: memberRows.map((m) => ({
                personId: m.id,
                role: m.personType === "Child" ? "Child" : "PrimaryCarer",
              })),
            }
          : undefined,
    },
    include: { members: true },
  });

  await logAudit({
    actorUserId: user.id,
    action: "family.create",
    entity: "Family",
    entityId: created.id,
    details: {
      familyName: created.familyName,
      memberIds: memberRows.map((m) => m.id),
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
