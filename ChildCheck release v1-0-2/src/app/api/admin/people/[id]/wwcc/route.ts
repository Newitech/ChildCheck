import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["Pending", "Verified", "Expired", "Cancelled"]);

const createSchema = z.object({
  cardType: z.string().trim().min(1).max(80),
  jurisdiction: z.string().trim().max(40).optional().nullable(),
  cardNumber: z.string().trim().max(80).optional().nullable(),
  status: z.string().refine((v) => STATUSES.has(v)).default("Pending"),
  issuedAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

function nullIfEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

/** GET /api/admin/people/[id]/wwcc — list cards for a person. Gated by flag. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const wwccEnabled = await isFeatureEnabled("working_with_children_tracking");
  if (!wwccEnabled) {
    return NextResponse.json({ items: [], enabled: false });
  }
  const { id } = await ctx.params;

  const person = await db.person.findUnique({
    where: { id },
    include: { wwccards: { orderBy: { createdAt: "desc" } } },
  });
  if (!person) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    enabled: true,
    items: person.wwccards.map((c) => ({
      id: c.id,
      cardType: c.cardType,
      jurisdiction: c.jurisdiction,
      cardNumber: c.cardNumber,
      status: c.status,
      issuedAt: c.issuedAt ? c.issuedAt.toISOString() : null,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      verifiedAt: c.verifiedAt ? c.verifiedAt.toISOString() : null,
      notes: c.notes,
    })),
  });
}

/** POST /api/admin/people/[id]/wwcc — add a card. */
export async function POST(
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

  const person = await db.person.findUnique({ where: { id } });
  if (!person) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
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

  const card = await db.workingWithChildrenCard.create({
    data: {
      personId: id,
      cardType: p.cardType,
      jurisdiction: nullIfEmpty(p.jurisdiction),
      cardNumber: nullIfEmpty(p.cardNumber),
      status: p.status,
      issuedAt: p.issuedAt ? new Date(p.issuedAt) : null,
      expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
      verifiedById: p.status === "Verified" ? user.id : null,
      verifiedAt: p.status === "Verified" ? new Date() : null,
      notes: nullIfEmpty(p.notes),
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "wwcc.create",
    entity: "WorkingWithChildrenCard",
    entityId: card.id,
    details: { personId: id, cardType: card.cardType, status: card.status },
  });

  return NextResponse.json({ id: card.id }, { status: 201 });
}
