import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  getOrgConfig,
  invalidateOrgConfigCache,
} from "@/lib/branding";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  dailyCodeLength: z.number().int().min(2).max(10),
  dailyCodeCharset: z.enum(["alphanumeric", "numeric"]),
});

/**
 * PUT /api/admin/organisation/code-settings
 *
 * Configures the daily check-out code: length (2–10) and charset
 * ("alphanumeric" — A-Z minus ambiguous + 2-9, ~30x harder to brute-force;
 * "numeric" — 0-9). Default is alphanumeric length 3. Existing codes remain
 * valid until they age out (checkout compares strings).
 */
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const org = await db.organisation.findFirst();
  if (!org) {
    return NextResponse.json({ error: "organisation not initialised" }, { status: 409 });
  }

  await db.organisation.update({
    where: { id: org.id },
    data: {
      dailyCodeLength: parsed.data.dailyCodeLength,
      dailyCodeCharset: parsed.data.dailyCodeCharset,
    },
  });
  invalidateOrgConfigCache();

  await logAudit({
    actorUserId: user.id,
    action: "org.code_settings.update",
    entity: "Organisation",
    entityId: org.id,
    details: parsed.data,
  });

  const config = await getOrgConfig();
  return NextResponse.json({
    ok: true,
    dailyCodeLength: config.dailyCodeLength,
    dailyCodeCharset: config.dailyCodeCharset,
  });
}
