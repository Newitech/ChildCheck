import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/feature-flags";

/**
 * Stage 4 — Collection-permission helpers.
 *
 * These functions are the core "who is allowed to collect this child" layer
 * that Stage 8 (kiosk checkout) will call. They consider:
 *
 *   1. PrimaryCarer membership in any family the child belongs to.
 *   2. AuthorisedGuardian membership (FamilyMember.role="AuthorisedGuardian")
 *      in any family the child belongs to.
 *   3. OlderSiblingAuthorisation (active, matching family, flag ON).
 *   4. BlacklistEntry that matches the collector — checked FIRST as a hard
 *      stop so it overrides any positive relationship (a blacklisted primary
 *      carer must NOT be allowed to collect).
 *
 * Precedence / decision order (documented):
 *   - First, look up BlacklistEntry matching (collectorPersonId OR
 *     collectorName) AND (childId OR any familyId the child belongs to).
 *     If a "blocked" entry matches → return {allowed:false, reason:"blacklisted"}.
 *     If only a "flag" entry matches → return {allowed:false, reason:"flagged"}.
 *     (Stage 8 surfaces "flagged" with a supervisor-override prompt.)
 *   - Otherwise, walk relationships in order:
 *       a. PrimaryCarer of a family the child belongs to → allowed.
 *       b. AuthorisedGuardian of a family the child belongs to → allowed.
 *       c. OlderSiblingAuthorisation (active, same family) when the
 *          `older_sibling_collect` flag is ON → allowed.
 *   - Otherwise → not_authorised.
 *
 * Notes:
 *   - AuthorisedGuardians have sign-in/out rights but NO edit rights on the
 *     family's data — `canEditFamily()` enforces this.
 *   - "blocked" severity always wins, even if the collector would otherwise
 *     be a primary carer.
 *   - All reads use Prisma; we memoise the flag lookup per request via the
 *     existing getFeatureFlags() 5s cache.
 */

export type CollectReason =
  | "primary_carer"
  | "authorised_guardian"
  | "older_sibling"
  | "blacklisted"
  | "flagged"
  | "not_authorised";

export interface CollectDecision {
  allowed: boolean;
  reason: CollectReason;
  /** Present when reason is "blacklisted" or "flagged". */
  blacklistEntry?: {
    id: string;
    reason: string;
    severity: string;
    collectorName?: string | null;
  };
  /** Present when reason is "older_sibling". */
  olderSiblingAuth?: {
    id: string;
    conditions?: string | null;
  };
}

export interface AuthorisedCollector {
  personId: string;
  firstName: string;
  lastName: string;
  basis: "primary_carer" | "authorised_guardian" | "older_sibling";
  familyName?: string;
  conditions?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the family IDs the child Person belongs to. */
async function familyIdsForChild(childId: string): Promise<string[]> {
  const rows = await db.familyMember.findMany({
    where: { personId: childId },
    select: { familyId: true },
  });
  return rows.map((r) => r.familyId);
}

/**
 * Look up any BlacklistEntry matching the collector + child.
 *
 * Matches if EITHER:
 *   - The collector is a known Person and BlacklistEntry.personId == collectorId,
 *     AND the entry's scope is (childId == this child) OR (familyId ∈ child's families).
 *   - (Free-text blacklist entries are only matched by the kiosk at lookup
 *     time using a name input — `canCollectChild` itself works on Person IDs,
 *     so free-text entries are checked separately by the kiosk UI via
 *     listBlacklistForChild.)
 *
 * Severity ordering: "blocked" > "flag". If both exist, "blocked" wins.
 */
async function findMatchingBlacklist(
  collectorPersonId: string,
  childId: string,
  familyIds: string[],
): Promise<{
  id: string;
  reason: string;
  severity: string;
  collectorName?: string | null;
} | null> {
  if (familyIds.length === 0) return null;
  const entries = await db.blacklistEntry.findMany({
    where: {
      personId: collectorPersonId,
      OR: [
        { childId },
        { familyId: { in: familyIds } },
      ],
    },
    select: {
      id: true,
      reason: true,
      severity: true,
      collectorName: true,
    },
  });
  if (entries.length === 0) return null;
  // "blocked" wins over "flag".
  const blocked = entries.find((e) => e.severity === "blocked");
  if (blocked) return blocked;
  return entries[0];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine whether `collector` (an Adult Person) is authorised to sign out
 * `child` (a Person). See module docs for the decision order.
 */
export async function canCollectChild(
  collector: { id: string },
  child: { id: string },
): Promise<CollectDecision> {
  const childId = child.id;
  const collectorId = collector.id;

  // 0. Defensive: make sure both persons exist.
  const [collectorPerson, childPerson] = await Promise.all([
    db.person.findUnique({ where: { id: collectorId }, select: { id: true, personType: true } }),
    db.person.findUnique({ where: { id: childId }, select: { id: true } }),
  ]);
  if (!collectorPerson || !childPerson) {
    return { allowed: false, reason: "not_authorised" };
  }

  // 1. Resolve the child's family memberships.
  const familyIds = await familyIdsForChild(childId);

  // 2. Blacklist FIRST (hard stop overrides relationships).
  const bl = await findMatchingBlacklist(collectorId, childId, familyIds);
  if (bl) {
    if (bl.severity === "blocked") {
      return {
        allowed: false,
        reason: "blacklisted",
        blacklistEntry: bl,
      };
    }
    // "flag" severity — warn operator (Stage 8 wires supervisor override).
    return {
      allowed: false,
      reason: "flagged",
      blacklistEntry: bl,
    };
  }

  // 3. PrimaryCarer membership in any of the child's families.
  const primaryCarerMembership = await db.familyMember.findFirst({
    where: {
      personId: collectorId,
      familyId: { in: familyIds },
      role: "PrimaryCarer",
    },
    select: { id: true },
  });
  if (primaryCarerMembership) {
    return { allowed: true, reason: "primary_carer" };
  }

  // 4. AuthorisedGuardian membership in any of the child's families.
  const guardianMembership = await db.familyMember.findFirst({
    where: {
      personId: collectorId,
      familyId: { in: familyIds },
      role: "AuthorisedGuardian",
    },
    select: { id: true },
  });
  if (guardianMembership) {
    return { allowed: true, reason: "authorised_guardian" };
  }

  // 5. Older-sibling authorisation (gated by flag).
  const olderSiblingFlagOn = await isFeatureEnabled("older_sibling_collect");
  if (olderSiblingFlagOn) {
    const older = await db.olderSiblingAuthorisation.findFirst({
      where: {
        youngerChildId: childId,
        olderSiblingId: collectorId,
        familyId: { in: familyIds },
        isActive: true,
      },
      select: { id: true, conditions: true },
    });
    if (older) {
      return {
        allowed: true,
        reason: "older_sibling",
        olderSiblingAuth: { id: older.id, conditions: older.conditions },
      };
    }
  }

  return { allowed: false, reason: "not_authorised" };
}

/**
 * List all Adults authorised to collect a given child.
 * Used by the kiosk "who can collect" display + admin UI.
 *
 * Does NOT include blacklisted persons (the kiosk surfaces those separately
 * as a hard-stop list).
 */
export async function listAuthorisedCollectors(
  childId: string,
): Promise<AuthorisedCollector[]> {
  // Resolve the child's family memberships with family + member details.
  const memberships = await db.familyMember.findMany({
    where: { personId: childId },
    include: {
      family: {
        select: { id: true, familyName: true },
      },
    },
  });
  if (memberships.length === 0) return [];

  const familyIds = memberships.map((m) => m.familyId);
  const familyNameById = new Map(
    memberships.map((m) => [m.family.id, m.family.familyName] as const),
  );

  const out: AuthorisedCollector[] = [];
  const seen = new Set<string>(); // dedupe across families

  // Primary carers + AuthorisedGuardians across all the child's families.
  const carers = await db.familyMember.findMany({
    where: {
      familyId: { in: familyIds },
      role: { in: ["PrimaryCarer", "AuthorisedGuardian"] },
    },
    include: {
      person: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          personType: true,
          isActive: true,
        },
      },
    },
  });
  for (const c of carers) {
    if (!c.person.isActive) continue;
    const key = `${c.person.id}:${c.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      personId: c.person.id,
      firstName: c.person.firstName,
      lastName: c.person.lastName,
      basis:
        c.role === "PrimaryCarer" ? "primary_carer" : "authorised_guardian",
      familyName: familyNameById.get(c.familyId),
    });
  }

  // Older-sibling authorisations (flag-gated).
  const olderSiblingFlagOn = await isFeatureEnabled("older_sibling_collect");
  if (olderSiblingFlagOn) {
    const auths = await db.olderSiblingAuthorisation.findMany({
      where: {
        youngerChildId: childId,
        familyId: { in: familyIds },
        isActive: true,
      },
      include: {
        olderSibling: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            isActive: true,
          },
        },
        family: { select: { familyName: true } },
      },
    });
    for (const a of auths) {
      if (!a.olderSibling.isActive) continue;
      const key = `${a.olderSibling.id}:older_sibling`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        personId: a.olderSibling.id,
        firstName: a.olderSibling.firstName,
        lastName: a.olderSibling.lastName,
        basis: "older_sibling",
        familyName: a.family.familyName,
        conditions: a.conditions,
      });
    }
  }

  return out;
}

/**
 * List blacklist entries that apply to a given child (both child-specific and
 * family-level — the family-level ones cascade). The kiosk uses this to draw
 * the "blocked collectors" list, and the person detail page uses it to show
 * who is blocked from collecting this child.
 */
export async function listBlacklistForChild(childId: string): Promise<
  Array<{
    id: string;
    reason: string;
    severity: string;
    collectorName: string | null;
    collectorDescription: string | null;
    personId: string | null;
    scope: "child" | "family";
    familyName?: string | null;
    childName?: string | null;
  }>
> {
  const familyIds = await familyIdsForChild(childId);
  const entries = await db.blacklistEntry.findMany({
    where: {
      OR: [
        { childId },
        ...(familyIds.length > 0 ? [{ familyId: { in: familyIds } }] : []),
      ],
    },
    include: {
      person: { select: { firstName: true, lastName: true } },
      family: { select: { familyName: true } },
      child: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return entries.map((e) => ({
    id: e.id,
    reason: e.reason,
    severity: e.severity,
    collectorName:
      e.collectorName ??
      (e.person ? `${e.person.firstName} ${e.person.lastName}` : null),
    collectorDescription: e.collectorDescription,
    personId: e.personId,
    scope: e.childId ? ("child" as const) : ("family" as const),
    familyName: e.family?.familyName ?? null,
    childName: e.child
      ? `${e.child.firstName} ${e.child.lastName}`
      : null,
  }));
}

/**
 * Check whether a given Adult Person has edit rights on a family.
 * PrimaryCarers have edit rights; AuthorisedGuardians do NOT (they can only
 * sign in/out). Stage 8 kiosk + future guardian self-service will use this.
 */
export async function canEditFamily(
  adultPersonId: string,
  familyId: string,
): Promise<boolean> {
  const membership = await db.familyMember.findUnique({
    where: { familyId_personId: { familyId, personId: adultPersonId } },
    select: { role: true },
  });
  if (!membership) return false;
  // Only PrimaryCarer (and Admin via separate role check) can edit.
  return membership.role === "PrimaryCarer";
}
