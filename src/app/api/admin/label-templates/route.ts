import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  DEFAULT_LABEL_LAYOUT,
  parseLayout,
  type LabelLayout,
} from "@/lib/printing";

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

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  layout: layoutSchema,
  isDefault: z.boolean().optional(),
});

/**
 * GET /api/admin/label-templates — list templates.
 *
 * Lazily seeds the default template on first call so the admin UI never shows
 * an empty state without a usable default.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Seed default if none exist.
  const count = await db.labelTemplate.count();
  if (count === 0) {
    await db.labelTemplate.create({
      data: {
        name: "Default label",
        layout: JSON.stringify(DEFAULT_LABEL_LAYOUT),
        isDefault: true,
      },
    });
  }

  const templates = await db.labelTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({
    items: templates.map((t) => ({
      id: t.id,
      name: t.name,
      layout: parseLayout(t.layout),
      isDefault: t.isDefault,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}

/**
 * POST /api/admin/label-templates — create a new template.
 * Requires manage_programs.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
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

  if (p.isDefault) {
    await db.labelTemplate.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }

  const created = await db.labelTemplate.create({
    data: {
      name: p.name,
      layout: JSON.stringify(p.layout satisfies LabelLayout),
      isDefault: p.isDefault ?? false,
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "label_template.add",
    entity: "LabelTemplate",
    entityId: created.id,
    details: { name: created.name, isDefault: created.isDefault },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
