import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  getOrgConfig,
  invalidateOrgConfigCache,
} from "@/lib/branding";
import { invalidateFlagCache, FEATURE_FLAGS } from "@/lib/feature-flags";
import { DEFAULT_TERMINOLOGY } from "@/lib/branding";
import { getProfile, isOrgType, ORG_PROFILES } from "@/lib/org-profiles";
import { seedDefaultPrograms } from "@/lib/seed-programs";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orgType: z.string().refine(isOrgType, {
    message:
      "unknown orgType — must be one of SDA | SundayChurch | Scouts | Childcare | School | Club | Other",
  }),
});

/** Ensure the singleton Organisation row exists, then return it. */
async function ensureOrg() {
  const existing = await db.organisation.findFirst();
  if (existing) return existing;
  return db.organisation.create({ data: { id: "default" } });
}

function safeParseTerm(s: string | null): Record<string, string> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Look up a flag's built-in default from the FEATURE_FLAGS registry. */
async function getDefaultFlag(
  tx: Parameters<Parameters<typeof db["$transaction"]>[0]>[0],
  key: string,
): Promise<boolean> {
  const def = FEATURE_FLAGS.find((f) => f.key === key);
  return def ? def.default : false;
}

/**
 * POST /api/admin/organisation/profile
 *
 * Applies an org-type profile (SDA / SundayChurch / Scouts / etc.) to this
 * organisation. Profile application is a MERGE, not a wipe:
 *   - Terminology: profile keys overwrite existing values for the SAME keys,
 *     but other user-customised keys are preserved.
 *   - Feature flags: only the keys present in the profile are upserted;
 *     other flags are left untouched.
 *
 * Also sets Organisation.orgType. Invalidates branding + flag caches.
 * Audit: "org.profile.apply" with details { orgType }.
 */
export async function POST(req: Request) {
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
  const { orgType } = parsed.data;
  const profile = getProfile(orgType);

  const org = await ensureOrg();

  // Merge semantics: applying a profile resets the UNION of all terminology
  // keys touched by ANY profile to the target profile's values (falling back
  // to DEFAULT_TERMINOLOGY when the target profile doesn't override a key).
  // This means switching Scouts → SDA restores group=Class, child=Child, etc.
  // Keys the target profile doesn't touch AND that no other profile touches
  // are preserved (genuine user customisations outside the profile system).
  const profileTouchedKeys = new Set<string>();
  for (const p of Object.values(ORG_PROFILES)) {
    for (const k of Object.keys(p.terminology)) profileTouchedKeys.add(k);
  }

  const existingTerm = safeParseTerm(org.terminology);
  const mergedTerm: Record<string, string> = {};

  // 1. Preserve genuine user customisations (keys NOT touched by any profile).
  for (const [k, v] of Object.entries(existingTerm)) {
    if (!profileTouchedKeys.has(k)) mergedTerm[k] = v;
  }
  // 2. For every profile-touched key, use the target profile's value, or fall
  //    back to DEFAULT_TERMINOLOGY. Only store overrides that differ from the
  //    default (keeps storage clean and lets getOrgConfig merge correctly).
  for (const k of profileTouchedKeys) {
    const targetVal = profile.terminology[k] ?? DEFAULT_TERMINOLOGY[k];
    if (targetVal && targetVal !== DEFAULT_TERMINOLOGY[k]) {
      mergedTerm[k] = targetVal;
    }
  }

  // Same union-based reset for flags the profile system owns.
  const profileTouchedFlags = new Set<string>();
  for (const p of Object.values(ORG_PROFILES)) {
    for (const k of Object.keys(p.flags)) profileTouchedFlags.add(k);
  }

  await db.$transaction(async (tx) => {
    await tx.organisation.update({
      where: { id: org.id },
      data: {
        orgType,
        terminology: JSON.stringify(mergedTerm),
        // Reset week-start to the profile's default. SDA = Sunday (0); other
        // profiles pick a sensible default (see org-profiles.ts). Admins can
        // override afterwards via /admin/settings.
        weekStartsOn: profile.weekStartsOn,
      },
    });
    // For every profile-touched flag, upsert the target profile's value
    // (or the flag's own default if the profile doesn't override it).
    for (const key of profileTouchedFlags) {
      const value = profile.flags[key] ?? (await getDefaultFlag(tx, key));
      await tx.featureFlag.upsert({
        where: { key },
        create: { key, value, updatedBy: user.id },
        update: { value, updatedBy: user.id },
      });
    }
  });

  invalidateOrgConfigCache();
  invalidateFlagCache();

  await logAudit({
    actorUserId: user.id,
    action: "org.profile.apply",
    entity: "Organisation",
    entityId: org.id,
    details: { orgType },
  });

  // Stage 5 — re-seed the default programs for the new org type. Idempotent:
  // existing programs (matched by slug) are skipped, so this only adds
  // missing ones. Applying Scouts after SDA keeps the Sabbath School program
  // and adds the renamed default programs that Scouts would expect (which
  // share the same slugs — so in practice nothing new is created when
  // switching between non-"Other" profiles; only the org-type field changes).
  // For an "Other" org type, no seeding runs.
  try {
    await seedDefaultPrograms(orgType, user.id);
  } catch (err) {
    console.error("[profile] program re-seeding failed:", err);
    // Non-fatal — admin can re-run from the Programs admin page.
  }

  const config = await getOrgConfig();
  return NextResponse.json({
    ok: true,
    orgType,
    branding: config.branding,
    terminology: config.terminology,
  });
}

/**
 * GET /api/admin/organisation/profile — return the list of available
 * profiles + the currently-applied one. Used by the settings UI to render
 * the "Organisation type" selector.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const config = await getOrgConfig();
  const profiles = Object.values(ORG_PROFILES).map((p) => ({
    type: p.type,
    label: p.label,
    description: p.description,
  }));
  const current = getProfile(config.orgType);
  return NextResponse.json({
    current: {
      type: current.type,
      label: current.label,
      description: current.description,
    },
    profiles,
  });
}
