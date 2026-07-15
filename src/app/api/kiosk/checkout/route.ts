import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { startOfDayUTC } from "@/lib/daily-code";
import { canCollectChild } from "@/lib/guardians";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import { broadcastRealtime, roomsForScope } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/checkout — Stage 8 check-out flow.
 *
 * Performs multi-child check-out for a family using one of three methods:
 *
 *   1. "code"     — enter the family's daily code → fast sign-out of any
 *                    subset of currently-checked-in children. The code is the
 *                    authorisation (no specific collector identified).
 *   2. "pin"      — guardian PIN verifies the adult collecting. Each child is
 *                    then checked against `canCollectChild(collector, child)`.
 *                    Blocked children are rejected; others proceed.
 *   3. "override" — Admin/Security/Teacher only (per `override_checkout` flag)
 *                    + mandatory confirmation checkbox + mandatory free-text
 *                    note. Used when a flagged person (or unknown adult) is
 *                    released with supervisor phone-confirmation. Writes an
 *                    OverrideCheckoutLog row per overridden child.
 *
 * HARD RULE — BLACKLIST IS ABSOLUTE:
 *   A "blocked" severity BlacklistEntry can NEVER be overridden, even by an
 *   Admin via the override method. Only "flag" severity entries can be
 *   overridden (and even then only via the override method with the
 *   mandatory note + checkbox).
 *
 *   For the "code" method, there is no collector identity, so person-based
 *   blacklist checks are skipped — the code itself is the authorisation. We
 *   accept this trade-off because the code is held only by authorised carers
 *   and is rate-limited + per-family-per-day. Free-text blacklist entries
 *   (collectorName) can't be matched without a collector identity either.
 *
 * PHOTO VERIFICATION:
 *   When `photo_verification` flag is ON, the operator MUST tick the
 *   "I have visually verified the collector matches the photo" checkbox on
 *   the kiosk, and the API receives `photoVerified: true`. If the flag is ON
 *   and photoVerified is not true → 400.
 *
 * IDEMPOTENCY:
 *   A child already checked out (checkedOutAt not null) is returned in the
 *   `skipped` array, not re-processed.
 *
 * Body:
 *   {
 *     familyId: string,
 *     childPersonIds: string[],
 *     method: "code" | "pin" | "override",
 *     code?: string,                      // method "code"
 *     collectorPersonId?: string | null,  // method "pin" / "override"
 *     overrideNote?: string,              // method "override" — min 10 chars
 *     overrideConfirmed?: boolean,        // method "override" — must be true
 *     photoVerified?: boolean             // when photo_verification flag ON
 *   }
 *
 * Returns:
 *   200 { ok, checkedOut: [...], skipped: [...], blocked: [...] }
 *   400 { error: "validation" | "photo_verification_required" | "override_note_required" | "override_confirmation_required" }
 *   401 { error: "invalid_code" | "unauthorized" }
 *   403 { error: "forbidden" | "override_disabled" }
 *   404 { error: "not_found" }
 *   409 { error: "pin_signin_disabled" }
 *   429 { error: "rate_limited", retryAfterMs }
 */

const methodEnum = z.enum(["code", "pin", "override"]);

const bodySchema = z.object({
  familyId: z.string().min(1),
  childPersonIds: z.array(z.string().min(1)).min(1),
  method: methodEnum,
  code: z.string().trim().max(20).optional().nullable(),
  collectorPersonId: z.string().min(1).optional().nullable(),
  overrideNote: z.string().max(4000).optional().nullable(),
  overrideConfirmed: z.boolean().optional().nullable(),
  photoVerified: z.boolean().optional().nullable(),
});

// 5 code attempts / minute / family — same pattern as guardian-signin.
const codeLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });
// 5 PIN attempts / minute / family.
const pinLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

type BlockedResult = {
  childPersonId: string;
  reason: "blacklisted" | "flagged_requires_override" | "not_authorised";
  blacklistEntryId?: string;
  blacklistReason?: string;
  severity?: string;
};

type CheckedOutResult = {
  childPersonId: string;
  checkInRecordId: string;
  method: "code" | "pin" | "override";
  collectorPersonId: string | null;
};

type SkippedResult = {
  childPersonId: string;
  reason: "already_checked_out";
};

export async function POST(req: Request) {
  // -----------------------------------------------------------------------
  // Parse + validate body.
  // -----------------------------------------------------------------------
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
  const {
    familyId,
    childPersonIds,
    method,
    code,
    collectorPersonId,
    overrideNote,
    overrideConfirmed,
    photoVerified,
  } = parsed.data;

  const ip = getClientIp(req);
  const flags = await getFeatureFlags();
  const today = new Date();
  const dayStart = startOfDayUTC(today);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  // -----------------------------------------------------------------------
  // Photo verification gate — applies to ALL methods when flag is ON.
  // -----------------------------------------------------------------------
  if (flags.photo_verification) {
    if (!photoVerified) {
      return NextResponse.json(
        { error: "photo_verification_required" },
        { status: 400 },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Look up the family.
  // -----------------------------------------------------------------------
  const family = await db.family.findUnique({
    where: { id: familyId, isActive: true },
    select: { id: true, familyName: true },
  });
  if (!family) {
    return NextResponse.json(
      { error: "not_found", message: "Family not found" },
      { status: 404 },
    );
  }

  // -----------------------------------------------------------------------
  // Look up the family's OPEN check-in records for the requested children
  // today. We only consider records that are NOT yet checked out — closed
  // records are ignored entirely (the child is reported as `skipped` if they
  // have no open record but were requested).
  // -----------------------------------------------------------------------
  const openRecords = await db.checkInRecord.findMany({
    where: {
      familyId,
      childPersonId: { in: childPersonIds },
      checkedInAt: { gte: dayStart, lt: dayEnd },
      checkedOutAt: null,
    },
    include: {
      checkInSession: { select: { id: true, programId: true, eventId: true } },
    },
  });

  // Build a set of requested child IDs that have an open record. The rest
  // are either already checked out (closed record today) or never checked
  // in today — both cases go to `skipped` for the response.
  const openChildIds = new Set(openRecords.map((r) => r.childPersonId));
  const preSkipped: SkippedResult[] = childPersonIds
    .filter((cid) => !openChildIds.has(cid))
    .map((cid) => ({ childPersonId: cid, reason: "already_checked_out" as const }));

  // The authorisation state set by the method-specific branches below.
  let authorisedActorUserId: string | null = null; // for audit
  let resolvedCollectorPersonId: string | null = null; // who collected
  const resolvedMethod: "code" | "pin" | "override" = method;
  let isOverride = false;
  let overrideNoteText: string | null = null;

  // -----------------------------------------------------------------------
  // METHOD: code
  // -----------------------------------------------------------------------
  if (method === "code") {
    // Rate limit (per family).
    const rlKey = `checkout-code:${familyId}`;
    const rl = codeLimiter.check(rlKey);
    if (!rl.allowed) {
      await logAudit({
        actorUserId: null,
        action: "checkout.code_rate_limited",
        entity: "Family",
        entityId: familyId,
        details: { ip },
      });
      return NextResponse.json(
        { error: "rate_limited", retryAfterMs: rl.retryAfterMs },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
          },
        },
      );
    }

    if (!code || code.length === 0) {
      return NextResponse.json(
        { error: "validation", message: "code required for method 'code'" },
        { status: 400 },
      );
    }

    const dailyCode = await db.dailyCode.findUnique({
      where: { familyId_codeDate: { familyId, codeDate: dayStart } },
      select: { code: true },
    });
    // Compare case-insensitively, trimmed.
    const expected = (dailyCode?.code ?? "").trim().toUpperCase();
    const supplied = code.trim().toUpperCase();
    if (!expected || expected !== supplied) {
      await logAudit({
        actorUserId: null,
        action: "checkout.code_failed",
        entity: "Family",
        entityId: familyId,
        details: { ip }, // never log the attempted code
      });
      return NextResponse.json(
        { error: "invalid_code" },
        { status: 401 },
      );
    }
    // Code verified — collector is "verified by code", no specific person.
    resolvedCollectorPersonId = null;
    // No blacklist check for code method (no collector identity to match).
  }

  // -----------------------------------------------------------------------
  // METHOD: pin
  // -----------------------------------------------------------------------
  else if (method === "pin") {
    if (!flags.guardian_pin_signin) {
      return NextResponse.json(
        { error: "pin_signin_disabled" },
        { status: 409 },
      );
    }
    // Re-use the rate-limit key prefix used by guardian-signin so the limits
    // compose correctly across both endpoints.
    const rlKey = `pin:${familyId}`;
    const rl = pinLimiter.check(rlKey);
    if (!rl.allowed) {
      await logAudit({
        actorUserId: null,
        action: "guardian.pin_rate_limited",
        entity: "Family",
        entityId: familyId,
        details: { ip },
      });
      return NextResponse.json(
        { error: "rate_limited", retryAfterMs: rl.retryAfterMs },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
          },
        },
      );
    }

    // The kiosk must call /api/kiosk/guardian-signin FIRST to verify the PIN
    // and get the collectorPersonId. We re-verify here by checking that
    // collectorPersonId is a PrimaryCarer / AuthorisedGuardian of the family.
    if (!collectorPersonId) {
      return NextResponse.json(
        { error: "validation", message: "collectorPersonId required for method 'pin'" },
        { status: 400 },
      );
    }
    const membership = await db.familyMember.findFirst({
      where: {
        familyId,
        personId: collectorPersonId,
        role: { in: ["PrimaryCarer", "AuthorisedGuardian"] },
        person: { personType: "Adult", isActive: true },
      },
      select: {
        id: true,
        role: true,
        person: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            pinHash: true,
          },
        },
      },
    });
    if (!membership) {
      return NextResponse.json(
        { error: "forbidden", message: "collector is not an authorised carer/guardian of this family" },
        { status: 403 },
      );
    }
    // As an extra defence-in-depth check, also verify that the collector
    // actually has a PIN set (so we know PIN verification could have
    // succeeded). We don't take the PIN in this API — that's the
    // guardian-signin endpoint's job. The PIN lives on Person (not User), so a
    // login account is not required.
    if (!membership.person.pinHash) {
      return NextResponse.json(
        { error: "forbidden", message: "collector has no PIN set" },
        { status: 403 },
      );
    }
    resolvedCollectorPersonId = collectorPersonId;
  }

  // -----------------------------------------------------------------------
  // METHOD: override
  // -----------------------------------------------------------------------
  else if (method === "override") {
    if (!flags.override_checkout) {
      return NextResponse.json(
        { error: "override_disabled" },
        { status: 403 },
      );
    }
    // Requires an authenticated session with role Admin/Security/Teacher.
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Sign in as staff to override" },
        { status: 401 },
      );
    }
    const staffOk =
      user.roles.includes("Admin") ||
      user.roles.includes("Security") ||
      user.roles.includes("Teacher") ||
      hasPermission(user.roles, "override_checkout");
    if (!staffOk) {
      return NextResponse.json(
        { error: "forbidden", message: "Staff role required to override" },
        { status: 403 },
      );
    }
    // Mandatory confirmation + note.
    if (!overrideConfirmed) {
      return NextResponse.json(
        { error: "override_confirmation_required" },
        { status: 400 },
      );
    }
    const note = (overrideNote ?? "").trim();
    if (note.length < 10) {
      return NextResponse.json(
        { error: "override_note_required", message: "Override note must be at least 10 characters" },
        { status: 400 },
      );
    }
    authorisedActorUserId = user.id;
    resolvedCollectorPersonId = collectorPersonId ?? null;
    isOverride = true;
    overrideNoteText = note;
  }

  // `method` is exhaustive above; this is unreachable but keeps TS happy.
  else {
    return NextResponse.json(
      { error: "validation", message: "unknown method" },
      { status: 400 },
    );
  }

  // -----------------------------------------------------------------------
  // Group open records by child. A child may have multiple open records
  // today (e.g. checked in to a Sabbath School session AND an event). We
  // treat each child as a single unit — the canCollectChild decision is
  // made once per child, and all that child's open records are processed
  // together (either all blocked, all checked out, or all skipped).
  // -----------------------------------------------------------------------
  const openRecordsByChild = new Map<string, typeof openRecords>();
  for (const rec of openRecords) {
    const arr = openRecordsByChild.get(rec.childPersonId) ?? [];
    arr.push(rec);
    openRecordsByChild.set(rec.childPersonId, arr);
  }

  // -----------------------------------------------------------------------
  // For "pin" and "override" methods, run `canCollectChild` for each child
  // to enforce the blacklist hard-stop. Blocked → always blocked. Flagged →
  // allowed only via override. Not-authorised → allowed only via override.
  //
  // For "code" method we skip this (no collector identity).
  // -----------------------------------------------------------------------
  const blocked: BlockedResult[] = [];

  if (resolvedCollectorPersonId && (method === "pin" || method === "override")) {
    for (const [childId, recs] of openRecordsByChild) {
      const decision = await canCollectChild(
        { id: resolvedCollectorPersonId },
        { id: childId },
      );

      if (decision.allowed) {
        // Allowed via primary_carer / authorised_guardian / older_sibling.
        continue;
      }

      if (decision.reason === "blacklisted") {
        // ABSOLUTE hard stop — never overridden, even by Admin.
        blocked.push({
          childPersonId: childId,
          reason: "blacklisted",
          blacklistEntryId: decision.blacklistEntry?.id,
          blacklistReason: decision.blacklistEntry?.reason,
          severity: decision.blacklistEntry?.severity,
        });
        // Audit the block (security alert) — one entry per child (not per
        // open record) to avoid log spam.
        for (const rec of recs) {
          await logAudit({
            actorUserId: authorisedActorUserId,
            action: "checkout.blocked",
            entity: "CheckInRecord",
            entityId: rec.id,
            details: {
              familyId,
              childPersonId: childId,
              collectorPersonId: resolvedCollectorPersonId,
              blacklistEntryId: decision.blacklistEntry?.id ?? null,
              method,
            },
            ip,
          });
        }
      } else if (decision.reason === "flagged") {
        // Override allowed (the override method itself authorises this).
        if (!isOverride) {
          blocked.push({
            childPersonId: childId,
            reason: "flagged_requires_override",
            blacklistEntryId: decision.blacklistEntry?.id,
            blacklistReason: decision.blacklistEntry?.reason,
            severity: decision.blacklistEntry?.severity,
          });
        }
        // else: override + flagged = proceed (with audit trail).
      } else {
        // "not_authorised" — only override can proceed.
        if (!isOverride) {
          blocked.push({
            childPersonId: childId,
            reason: "not_authorised",
          });
        }
      }
    }
  }

  // Partition records into processable / skipped / blocked.
  const blockedChildIds = new Set(blocked.map((b) => b.childPersonId));
  const checkedOut: CheckedOutResult[] = [];
  const skipped: SkippedResult[] = [...preSkipped];

  // -----------------------------------------------------------------------
  // Transaction: for each non-blocked child, check out ALL their open
  // records today. (Children not in openRecordsByChild are already in
  // `preSkipped`.)
  // -----------------------------------------------------------------------
  const recordsToProcess: typeof openRecords = [];
  for (const [childId, recs] of openRecordsByChild) {
    if (blockedChildIds.has(childId)) continue;
    for (const rec of recs) recordsToProcess.push(rec);
  }

  // Pre-fetch child names for audit (avoid N+1 inside tx).
  const childIdsToProcess = Array.from(new Set(recordsToProcess.map((r) => r.childPersonId)));
  const childPersons = childIdsToProcess.length
    ? await db.person.findMany({
        where: { id: { in: childIdsToProcess } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const childNameById = new Map(
    childPersons.map((p) => [p.id, `${p.firstName} ${p.lastName}`]),
  );

  // Track which children have already been pushed to checkedOut (so we
  // return one entry per child, not per record).
  const checkedOutChildIds = new Set<string>();
  await db.$transaction(async (tx) => {
    for (const rec of recordsToProcess) {
      await tx.checkInRecord.update({
        where: { id: rec.id },
        data: {
          checkedOutAt: new Date(),
          checkedOutByPersonId: resolvedCollectorPersonId,
          checkedOutByUserId: authorisedActorUserId,
          checkoutMethod: resolvedMethod,
          overrideNote: overrideNoteText,
          photoVerified: flags.photo_verification ? true : null,
        },
      });
      // For override, write an OverrideCheckoutLog row PER record (so the
      // paper trail covers every check-in session that was overridden).
      if (isOverride) {
        await tx.overrideCheckoutLog.create({
          data: {
            checkInRecordId: rec.id,
            childPersonId: rec.childPersonId,
            collectorPersonId: resolvedCollectorPersonId,
            authorisingUserId: authorisedActorUserId!,
            note: overrideNoteText!,
            confirmed: true,
          },
        });
      }
      if (!checkedOutChildIds.has(rec.childPersonId)) {
        checkedOutChildIds.add(rec.childPersonId);
        checkedOut.push({
          childPersonId: rec.childPersonId,
          checkInRecordId: rec.id,
          method: resolvedMethod,
          collectorPersonId: resolvedCollectorPersonId,
        });
      }
    }
  });

  // -----------------------------------------------------------------------
  // Audit log. Best-effort.
  // -----------------------------------------------------------------------
  await logAudit({
    actorUserId: authorisedActorUserId,
    action: "checkout",
    entity: "Family",
    entityId: familyId,
    details: {
      familyId,
      method: resolvedMethod,
      collectorPersonId: resolvedCollectorPersonId,
      checkedOutCount: checkedOut.length,
      skippedCount: skipped.length,
      blockedCount: blocked.length,
      blockedChildren: blocked.map((b) => ({
        childPersonId: b.childPersonId,
        reason: b.reason,
        blacklistEntryId: b.blacklistEntryId ?? null,
      })),
      photoVerified: flags.photo_verification ? true : null,
      overrideNote: isOverride ? overrideNoteText : null,
      childNames: checkedOut.map(
        (c) => childNameById.get(c.childPersonId) ?? c.childPersonId,
      ),
    },
    ip,
  });

  // -----------------------------------------------------------------------
  // Realtime broadcast — notify the volunteer dashboard subscribed to any of
  // the rooms / classes / programs / sessions touched by this checkout.
  // Best-effort.
  // -----------------------------------------------------------------------
  if (checkedOut.length > 0) {
    const scopeRooms = new Set<string>();
    for (const rec of recordsToProcess) {
      // Only the actually-processed records.
      if (!checkedOutChildIds.has(rec.childPersonId)) continue;
      for (const r of roomsForScope({
        roomId: rec.roomId,
        classId: rec.classId,
        programId: rec.checkInSession.programId,
        eventId: rec.checkInSession.eventId,
        checkInSessionId: rec.checkInSession.id,
      })) {
        scopeRooms.add(r);
      }
    }
    await broadcastRealtime({
      event: "checkout:update",
      rooms: Array.from(scopeRooms),
      payload: {
        familyId,
        method: resolvedMethod,
        checkedOutCount: checkedOut.length,
        childPersonIds: checkedOut.map((c) => c.childPersonId),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    checkedOut,
    skipped,
    blocked,
  });
}
