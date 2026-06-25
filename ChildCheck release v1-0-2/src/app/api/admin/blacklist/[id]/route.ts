import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const SEVERITIES = new Set(["blocked", "flag"]);

const updateSchema = z.object({
  reason: z.string().trim().min(1).max(2000).optional(),
  severity: z
    .string()
    .refine((v) => SEVERITIES.has(v))
    .optional(),
  collectorDescription: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable(),
});

/** PUT /api/admin/blacklist/[id] — update reason / severity / description. */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const existing = await db.blacklistEntry.findUnique({ where: { id } });
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

  if (p.reason !== undefined && p.reason !== existing.reason) {
    data.reason = p.reason;
    changed.reason = p.reason;
  }
  if (p.severity !== undefined && p.severity !== existing.severity) {
    data.severity = p.severity;
    changed.severity = p.severity;
  }
  if (p.collectorDescription !== undefined) {
    const v = p.collectorDescription;
    if (v !== existing.collectorDescription) {
      data.collectorDescription = v;
      changed.collectorDescription = v;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, changed: {} });
  }

  await db.blacklistEntry.update({ where: { id }, data });

  await logAudit({
    actorUserId: user.id,
    action: "blacklist.update",
    entity: "BlacklistEntry",
    entityId: id,
    details: changed,
  });

  return NextResponse.json({ ok: true, changed });
}

/** DELETE /api/admin/blacklist/[id] — remove a BlacklistEntry. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const existing = await db.blacklistEntry.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.blacklistEntry.delete({ where: { id } });

  await logAudit({
    actorUserId: user.id,
    action: "blacklist.remove",
    entity: "BlacklistEntry",
    entityId: id,
    details: {
      childId: existing.childId,
      familyId: existing.familyId,
      personId: existing.personId,
      collectorName: existing.collectorName,
      reason: existing.reason,
      severity: existing.severity,
    },
  });

  return NextResponse.json({ ok: true });
}
