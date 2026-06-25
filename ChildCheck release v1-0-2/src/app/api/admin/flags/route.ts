import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import {
  FEATURE_FLAGS,
  FLAG_KEYS,
  getFeatureFlags,
  setFeatureFlag,
} from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

/** GET /api/admin/flags — current values + definitions. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const flags = await getFeatureFlags();
  return NextResponse.json({ flags, defs: FEATURE_FLAGS });
}

const putSchema = z.object({
  flags: z.record(z.string(), z.boolean()),
});

/** PUT /api/admin/flags — apply a batch of flag updates (Admin only). */
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
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Reject any unknown keys.
  for (const key of Object.keys(parsed.data.flags)) {
    if (!FLAG_KEYS.has(key)) {
      return NextResponse.json(
        { error: `unknown flag key: ${key}` },
        { status: 400 },
      );
    }
  }

  for (const [key, value] of Object.entries(parsed.data.flags)) {
    await setFeatureFlag(key, value, user.id);
  }

  const flags = await getFeatureFlags();
  return NextResponse.json({ flags, defs: FEATURE_FLAGS });
}
