import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  DEFAULT_TERMINOLOGY,
  getOrgConfig,
  invalidateOrgConfigCache,
  type Terminology,
} from "@/lib/branding";

export const dynamic = "force-dynamic";

const TERMINOLOGY_KEYS = Object.keys(DEFAULT_TERMINOLOGY) as (keyof Terminology)[];

const hexRegex = /^#[0-9a-fA-F]{6}$/;

const brandingPutSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  appName: z.string().min(1).max(60).optional(),
  tagline: z.string().min(0).max(120).optional(),
  primaryColor: z.string().regex(hexRegex).optional(),
  accentColor: z.string().regex(hexRegex).optional(),
  terminology: z
    .record(z.string(), z.string().min(1).max(40))
    .optional()
    .refine(
      (rec) => !rec || Object.keys(rec).every((k) => TERMINOLOGY_KEYS.includes(k as keyof Terminology)),
      { message: "Unknown terminology key" },
    ),
});

/** Ensure a singleton Organisation row exists. */
async function ensureOrg() {
  const existing = await db.organisation.findFirst();
  if (existing) return existing;
  return db.organisation.create({ data: { id: "default" } });
}

/** GET /api/admin/branding — current branding + terminology (Admin only). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const config = await getOrgConfig();
  const org = await ensureOrg();
  return NextResponse.json({
    branding: config.branding,
    terminology: config.terminology,
    name: org.name,
    orgType: org.orgType || "SDA",
  });
}

/** PUT /api/admin/branding — update branding / terminology (Admin only). */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = brandingPutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  const org = await ensureOrg();

  // Merge terminology overrides over existing.
  const existingTerm: Record<string, string> = org.terminology
    ? safeParse(org.terminology)
    : {};
  const mergedTerm: Record<string, string> = { ...existingTerm };
  if (p.terminology) {
    for (const [k, v] of Object.entries(p.terminology)) {
      mergedTerm[k] = v;
    }
  }

  const changed: Record<string, unknown> = {};
  if (p.name !== undefined && p.name !== org.name) changed.name = p.name;
  if (p.appName !== undefined && p.appName !== org.appName) changed.appName = p.appName;
  if (p.tagline !== undefined && p.tagline !== org.tagline) changed.tagline = p.tagline;
  if (p.primaryColor !== undefined && p.primaryColor !== org.primaryColor) changed.primaryColor = p.primaryColor;
  if (p.accentColor !== undefined && p.accentColor !== org.accentColor) changed.accentColor = p.accentColor;
  if (p.terminology) changed.terminology = p.terminology;

  const updated = await db.organisation.update({
    where: { id: org.id },
    data: {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.appName !== undefined ? { appName: p.appName } : {}),
      ...(p.tagline !== undefined ? { tagline: p.tagline } : {}),
      ...(p.primaryColor !== undefined ? { primaryColor: p.primaryColor } : {}),
      ...(p.accentColor !== undefined ? { accentColor: p.accentColor } : {}),
      ...(p.terminology ? { terminology: JSON.stringify(mergedTerm) } : {}),
    },
  });

  invalidateOrgConfigCache();
  await logAudit({
    actorUserId: user.id,
    action: "branding.update",
    entity: "Organisation",
    entityId: updated.id,
    details: changed,
  });

  const config = await getOrgConfig();
  return NextResponse.json({
    branding: config.branding,
    terminology: config.terminology,
    name: updated.name,
  });
}

function safeParse(s: string): Record<string, string> {
  try {
    return JSON.parse(s) as Record<string, string>;
  } catch {
    return {};
  }
}
