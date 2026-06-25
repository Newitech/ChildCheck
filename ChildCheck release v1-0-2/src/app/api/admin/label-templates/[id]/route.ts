import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { parseLayout, type LabelLayout } from "@/lib/printing";

export const dynamic = "force-dynamic";

const fieldSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "code", "allergy_icon", "date"]),
  field: z.enum(["childName", "className", "roomName", "dailyCode", "date", "allergy"]),
  x: z.number().min(0).max(500),
  y: z.number().min(0).max(500),
  fontSize: z.number().min(4).max(120),
  bold: z.boolean().optional(),
  prefix: z.string().max(40).optional(),
});

const layoutSchema = z.object({
  width: z.number().min(10).max(500),
  height: z.number().min(10).max(500),
  fields: z.array(fieldSchema).max(40),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  layout: layoutSchema.optional(),
  isDefault: z.boolean().optional(),
});

/**
 * GET /api/admin/label-templates/[id] — single template.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const t = await db.labelTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    id: t.id,
    name: t.name,
    layout: parseLayout(t.layout),
    isDefault: t.isDefault,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  });
}

/**
 * PUT /api/admin/label-templates/[id] — update a template.
 * Requires manage_programs.
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

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

  const existing = await db.labelTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (p.isDefault) {
    await db.labelTemplate.updateMany({
      where: { isDefault: true, NOT: { id } },
      data: { isDefault: false },
    });
  }

  const updated = await db.labelTemplate.update({
    where: { id },
    data: {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.layout !== undefined
        ? { layout: JSON.stringify(p.layout satisfies LabelLayout) }
        : {}),
      ...(p.isDefault !== undefined ? { isDefault: p.isDefault } : {}),
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "label_template.update",
    entity: "LabelTemplate",
    entityId: id,
    details: p,
  });

  return NextResponse.json({ id: updated.id });
}

/**
 * DELETE /api/admin/label-templates/[id] — hard-delete a template.
 *
 * If the deleted template was the default, the first remaining template (if
 * any) is promoted to default so a default always exists.
 *
 * Requires manage_programs.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const existing = await db.labelTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.labelTemplate.delete({ where: { id } });

  // Promote a new default if we just deleted it.
  if (existing.isDefault) {
    const first = await db.labelTemplate.findFirst({
      orderBy: { updatedAt: "desc" },
    });
    if (first) {
      await db.labelTemplate.update({ where: { id: first.id }, data: { isDefault: true } });
    }
  }

  await logAudit({
    actorUserId: user.id,
    action: "label_template.remove",
    entity: "LabelTemplate",
    entityId: id,
    details: { name: existing.name },
  });

  return NextResponse.json({ ok: true });
}
