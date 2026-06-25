import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

/** 404 response used when the older_sibling_collect flag is OFF. */
function flagDisabled() {
  return NextResponse.json(
    {
      error:
        "older_sibling_collect feature flag is OFF — authorisations are not enabled",
    },
    { status: 404 },
  );
}

/**
 * DELETE /api/admin/older-sibling/[id] — remove an authorisation.
 * Flag-gated: 404 if the feature is OFF. DB rows are preserved if the flag is
 * later re-enabled; this endpoint only removes when the feature is active.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const enabled = await isFeatureEnabled("older_sibling_collect");
  if (!enabled) return flagDisabled();

  const { id } = await ctx.params;
  const existing = await db.olderSiblingAuthorisation.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.olderSiblingAuthorisation.delete({ where: { id } });

  await logAudit({
    actorUserId: user.id,
    action: "older_sibling.remove",
    entity: "OlderSiblingAuthorisation",
    entityId: id,
    details: {
      youngerChildId: existing.youngerChildId,
      olderSiblingId: existing.olderSiblingId,
      familyId: existing.familyId,
    },
  });

  return NextResponse.json({ ok: true });
}
