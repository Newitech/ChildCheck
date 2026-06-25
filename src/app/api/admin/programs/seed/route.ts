import { NextResponse } from "next/server";

import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getOrgConfig } from "@/lib/branding";
import { seedDefaultPrograms } from "@/lib/seed-programs";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/programs/seed — re-run the idempotent default-program
 * seeding for the org's current org-type profile. Backs the "Seed default
 * programs" button on the Programs admin page.
 *
 * Idempotent: programs that already exist (matched by slug) are skipped, so
 * this is safe to call repeatedly. Useful when an admin has deleted a default
 * program and wants it back, or after applying a new org-type profile.
 *
 * Requires manage_programs permission.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_programs")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const config = await getOrgConfig();
  const result = await seedDefaultPrograms(config.orgType, user.id);

  return NextResponse.json({
    ok: true,
    orgType: config.orgType,
    created: result.created,
    skipped: result.skipped,
  });
}
