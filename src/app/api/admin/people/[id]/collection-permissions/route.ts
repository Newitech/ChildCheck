import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  listAuthorisedCollectors,
  listBlacklistForChild,
} from "@/lib/guardians";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/people/[id]/collection-permissions
 *
 * For a Child Person: returns the complete "who can collect this child" view —
 *   - authorisedCollectors: primary carers + guardians + older siblings (if
 *     the older_sibling_collect flag is ON).
 *   - blacklistEntries: blocked / flagged collectors targeting this child
 *     (both child-specific and family-level entries cascade).
 *
 * Used by the person detail page's "Collection permissions" section. The kiosk
 * (Stage 8) will call listAuthorisedCollectors / canCollectChild directly
 * rather than this endpoint.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const person = await db.person.findUnique({
    where: { id },
    select: { id: true, personType: true, firstName: true, lastName: true },
  });
  if (!person) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }
  if (person.personType !== "Child") {
    return NextResponse.json(
      {
        error:
          "collection-permissions endpoint is only valid for Child persons",
        personType: person.personType,
      },
      { status: 400 },
    );
  }

  const olderSiblingFlagOn = await isFeatureEnabled("older_sibling_collect");

  const [authorisedCollectors, blacklistEntries] = await Promise.all([
    listAuthorisedCollectors(id),
    listBlacklistForChild(id),
  ]);

  return NextResponse.json({
    personId: person.id,
    personName: `${person.firstName} ${person.lastName}`,
    olderSiblingFlagOn,
    authorisedCollectors,
    blacklistEntries,
  });
}
