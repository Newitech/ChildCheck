import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["Pending", "Verified", "Expired", "Cancelled"]);

const updateSchema = z.object({
  cardType: z.string().trim().min(1).max(80).optional(),
  jurisdiction: z.string().trim().max(40).optional().nullable(),
  cardNumber: z.string().trim().max(80).optional().nullable(),
  status: z.string().refine((v) => STATUSES.has(v)).optional(),
  issuedAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  verifiedAt: z.string().datetime().optional().nullable(),
});

function nullIfEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

/** PUT /api/admin/wwcc/[id] — update a card (e.g. mark Verified, set expiry). */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const wwccEnabled = await isFeatureEnabled("working_with_children_tracking");
  if (!wwccEnabled) {
    return NextResponse.json(
      { error: "WWCC tracking is disabled" },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;

  const existing = await db.workingWithChildrenCard.findUnique({
    where: { id },
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

  if (p.cardType !== undefined && p.cardType !== existing.cardType) {
    data.cardType = p.cardType;
    changed.cardType = p.cardType;
  }
  if (p.jurisdiction !== undefined) {
    const v = nullIfEmpty(p.jurisdiction);
    if (v !== existing.jurisdiction) {
      data.jurisdiction = v;
      changed.jurisdiction = v;
    }
  }
  if (p.cardNumber !== undefined) {
    const v = nullIfEmpty(p.cardNumber);
    if (v !== existing.cardNumber) {
      data.cardNumber = v;
      changed.cardNumber = v;
    }
  }
  if (p.status !== undefined && p.status !== existing.status) {
    data.status = p.status;
    changed.status = p.status;
    if (p.status === "Verified") {
      data.verifiedById = user.id;
      data.verifiedAt = new Date();
      changed.verifiedById = user.id;
    }
  }
  if (p.issuedAt !== undefined) {
    const v = p.issuedAt ? new Date(p.issuedAt) : null;
    const existingIso = existing.issuedAt
      ? existing.issuedAt.toISOString()
      : null;
    const newIso = v ? v.toISOString() : null;
    if (newIso !== existingIso) {
      data.issuedAt = v;
      changed.issuedAt = newIso;
    }
  }
  if (p.expiresAt !== undefined) {
    const v = p.expiresAt ? new Date(p.expiresAt) : null;
    const existingIso = existing.expiresAt
      ? existing.expiresAt.toISOString()
      : null;
    const newIso = v ? v.toISOString() : null;
    if (newIso !== existingIso) {
      data.expiresAt = v;
      changed.expiresAt = newIso;
    }
  }
  if (p.notes !== undefined) {
    const v = nullIfEmpty(p.notes);
    if (v !== existing.notes) {
      data.notes = v;
      changed.notes = v;
    }
  }
  if (p.verifiedAt !== undefined) {
    const v = p.verifiedAt ? new Date(p.verifiedAt) : null;
    const existingIso = existing.verifiedAt
      ? existing.verifiedAt.toISOString()
      : null;
    const newIso = v ? v.toISOString() : null;
    if (newIso !== existingIso) {
      data.verifiedAt = v;
      changed.verifiedAt = newIso;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, changed: {} });
  }

  await db.workingWithChildrenCard.update({ where: { id }, data });

  await logAudit({
    actorUserId: user.id,
    action: "wwcc.update",
    entity: "WorkingWithChildrenCard",
    entityId: id,
    details: changed,
  });

  return NextResponse.json({ ok: true, changed });
}

/** DELETE /api/admin/wwcc/[id] — remove a card. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const wwccEnabled = await isFeatureEnabled("working_with_children_tracking");
  if (!wwccEnabled) {
    return NextResponse.json(
      { error: "WWCC tracking is disabled" },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;

  const existing = await db.workingWithChildrenCard.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.workingWithChildrenCard.delete({ where: { id } });

  await logAudit({
    actorUserId: user.id,
    action: "wwcc.delete",
    entity: "WorkingWithChildrenCard",
    entityId: id,
    details: { personId: existing.personId, cardType: existing.cardType },
  });

  return NextResponse.json({ ok: true });
}
