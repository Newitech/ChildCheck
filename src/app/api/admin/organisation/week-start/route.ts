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
  weekStartsOn: z.number().int().min(0).max(6),
});

/**
 * PUT /api/admin/organisation/week-start
 *
 * Sets which day the week starts on (0=Sunday … 6=Saturday) for calendar /
 * date-picker display + "day N of week" numbering. SDA default = 0 (Sunday;
 * Saturday = 7th-day Sabbath). Admins can override for any org.
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
    data: { weekStartsOn: parsed.data.weekStartsOn },
  });
  invalidateOrgConfigCache();

  await logAudit({
    actorUserId: user.id,
    action: "org.week_start.update",
    entity: "Organisation",
    entityId: org.id,
    details: { weekStartsOn: parsed.data.weekStartsOn },
  });

  const config = await getOrgConfig();
  return NextResponse.json({ ok: true, weekStartsOn: config.weekStartsOn });
}
