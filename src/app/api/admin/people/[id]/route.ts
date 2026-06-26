import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { loadPersonDetail, toPersonDetailDTO } from "@/lib/people";

export const dynamic = "force-dynamic";

const GENDERS = new Set(["Male", "Female", "Other"]);

const updateSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  middleName: z.string().trim().max(80).optional().nullable(),
  lastName: z.string().trim().min(1).max(80).optional(),
  preferredName: z.string().trim().min(0).max(80).optional().nullable(),
  personType: z.enum(["Adult", "Child"]).optional(),
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
  isVisitor: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

function nullIfEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

/** GET /api/admin/people/[id] — full detail. Includes medical fields. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const wwccEnabled = await isFeatureEnabled("working_with_children_tracking");

  const person = await loadPersonDetail(id, wwccEnabled);
  if (!person) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const dto = await toPersonDetailDTO(person, wwccEnabled);
  return NextResponse.json(dto);
}

/** PUT /api/admin/people/[id] — update fields. */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const existing = await db.person.findUnique({ where: { id } });
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
    if (v !== existing.middleName) {
      data.middleName = v;
      changed.middleName = v;
    }
  }
  if (p.lastName !== undefined && p.lastName !== existing.lastName) {
    data.lastName = p.lastName;
    changed.lastName = p.lastName;
  }
  if (p.preferredName !== undefined) {
    const v = nullIfEmpty(p.preferredName);
    if (v !== existing.preferredName) {
      data.preferredName = v;
      changed.preferredName = v;
    }
  }
  if (p.personType !== undefined && p.personType !== existing.personType) {
    data.personType = p.personType;
    changed.personType = p.personType;
  }
  if (p.email !== undefined) {
    const v = nullIfEmpty(p.email);
    if (v !== existing.email) {
      data.email = v;
      changed.email = v;
    }
  }
  if (p.phone !== undefined) {
    const v = nullIfEmpty(p.phone);
    if (v !== existing.phone) {
      data.phone = v;
      changed.phone = v;
    }
  }
  if (p.dateOfBirth !== undefined) {
    const v = p.dateOfBirth ? new Date(p.dateOfBirth) : null;
    const existingIso = existing.dateOfBirth
      ? existing.dateOfBirth.toISOString()
      : null;
    const newIso = v ? v.toISOString() : null;
    if (newIso !== existingIso) {
      data.dateOfBirth = v;
      changed.dateOfBirth = newIso;
    }
  }
  if (p.schoolGrade !== undefined) {
    const v = nullIfEmpty(p.schoolGrade);
    if (v !== existing.schoolGrade) {
      data.schoolGrade = v;
      changed.schoolGrade = v;
    }
  }
  if (p.gender !== undefined) {
    const v = p.gender === null ? null : (p.gender ?? null);
    if (v !== existing.gender) {
      data.gender = v;
      changed.gender = v;
    }
  }
  if (p.allergies !== undefined) {
    const v = nullIfEmpty(p.allergies);
    if (v !== existing.allergies) {
      data.allergies = v;
      changed.allergies = v;
    }
  }
  if (p.medicalNotes !== undefined) {
    const v = nullIfEmpty(p.medicalNotes);
    if (v !== existing.medicalNotes) {
      data.medicalNotes = v;
      changed.medicalNotes = v;
    }
  }
  if (p.dietaryNotes !== undefined) {
    const v = nullIfEmpty(p.dietaryNotes);
    if (v !== existing.dietaryNotes) {
      data.dietaryNotes = v;
      changed.dietaryNotes = v;
    }
  }
  if (p.emergencyContactName !== undefined) {
    const v = nullIfEmpty(p.emergencyContactName);
    if (v !== existing.emergencyContactName) {
      data.emergencyContactName = v;
      changed.emergencyContactName = v;
    }
  }
  if (p.emergencyContactPhone !== undefined) {
    const v = nullIfEmpty(p.emergencyContactPhone);
    if (v !== existing.emergencyContactPhone) {
      data.emergencyContactPhone = v;
      changed.emergencyContactPhone = v;
    }
  }
  if (p.isVisitor !== undefined && p.isVisitor !== existing.isVisitor) {
    data.isVisitor = p.isVisitor;
    changed.isVisitor = p.isVisitor;
  }
  if (p.isActive !== undefined && p.isActive !== existing.isActive) {
    data.isActive = p.isActive;
    changed.isActive = p.isActive;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, changed: {} });
  }

  await db.person.update({ where: { id }, data });

  await logAudit({
    actorUserId: user.id,
    action: "person.update",
    entity: "Person",
    entityId: id,
    details: changed,
  });

  return NextResponse.json({ ok: true, changed });
}

/**
 * DELETE /api/admin/people/[id] — soft-delete (isActive=false).
 * Hard-delete is forbidden (child-safety + audit). If the person has a
 * linked User, return 409 with an explanation (must disable the User first
 * or remove the link).
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const person = await db.person.findUnique({
    where: { id },
    include: { user: { select: { id: true } } },
  });
  if (!person) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (person.user) {
    return NextResponse.json(
      {
        error:
          "Person has a linked login account. Disable or remove the User account before deleting this Person.",
      },
      { status: 409 },
    );
  }
  if (!person.isActive) {
    return NextResponse.json({ ok: true, alreadyInactive: true });
  }

  await db.person.update({ where: { id }, data: { isActive: false } });

  await logAudit({
    actorUserId: user.id,
    action: "person.delete",
    entity: "Person",
    entityId: id,
    details: {
      softDelete: true,
      name: [person.firstName, person.middleName, person.lastName]
        .filter((s): s is string => !!s && s.trim().length > 0)
        .join(" "),
    },
  });

  return NextResponse.json({ ok: true });
}
