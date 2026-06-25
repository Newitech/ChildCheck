import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags";
import { canCollectChild } from "@/lib/guardians";
import { logAudit } from "@/lib/audit";
import { broadcastRealtime, roomsForScope } from "@/lib/realtime";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/volunteer/override-checkout
 *
 * Same rules as the kiosk override checkout (`/api/kiosk/checkout` with
 * method "override"), but for the volunteer dashboard context:
 *
 *   - Requires the `override_checkout` feature flag to be ON.
 *   - Requires an authenticated staff session (Admin / Security / Teacher)
 *     with the `override_checkout` permission.
 *   - Mandatory free-text note (min 10 chars).
 *   - Mandatory confirmation checkbox (the operator ticked "I have contacted
 *     and confirmed with an authorised carer/guardian").
 *   - HARD STOP: a "blocked" severity BlacklistEntry can NEVER be overridden —
 *     not even by an Admin. Only "flag" severity or "not_authorised" cases
 *     may be overridden.
 *   - Writes an OverrideCheckoutLog row per overridden child.
 *
 * Body:
 *   {
 *     childPersonId: string,
 *     checkInRecordId?: string | null,  // optional — narrow to one record
 *     collectorPersonId?: string | null,
 *     note: string (min 10 chars),
 *     confirmed: boolean (must be true)
 *   }
 *
 * Returns:
 *   200 { ok, checkedOut: [...], blocked: [...] }
 *   400 { error: "validation" | "override_note_required" | "override_confirmation_required" }
 *   401 { error: "unauthorized" }
 *   403 { error: "forbidden" | "override_disabled" }
 *   404 { error: "not_found" }
 */
const bodySchema = z.object({
  childPersonId: z.string().min(1),
  checkInRecordId: z.string().min(1).nullable().optional(),
  collectorPersonId: z.string().min(1).nullable().optional(),
  note: z.string().trim().min(10).max(4000),
  confirmed: z.boolean(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(user.roles, "override_checkout")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Staff role check (only Admin/Security/Teacher can override — not Volunteer).
  const staffOk =
    user.roles.includes("Admin") ||
    user.roles.includes("Security") ||
    user.roles.includes("Teacher");
  if (!staffOk) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
  const { childPersonId, checkInRecordId, collectorPersonId, note, confirmed } =
    parsed.data;

  // Override must be enabled.
  const flags = await getFeatureFlags();
  if (!flags.override_checkout) {
    return NextResponse.json({ error: "override_disabled" }, { status: 403 });
  }

  // Mandatory confirmation + note (zod already enforced note length).
  if (!confirmed) {
    return NextResponse.json(
      { error: "override_confirmation_required" },
      { status: 400 },
    );
  }

  // Find open records for this child.
  const where: Record<string, unknown> = {
    childPersonId,
    checkedOutAt: null,
  };
  if (checkInRecordId) {
    where.id = checkInRecordId;
  }
  const openRecords = await db.checkInRecord.findMany({
    where,
    include: {
      checkInSession: { select: { id: true, programId: true, eventId: true } },
    },
  });
  if (openRecords.length === 0) {
    return NextResponse.json(
      { error: "not_found", message: "No open check-in record for this child" },
      { status: 404 },
    );
  }

  // Blacklist hard-stop: if a collector was identified, check canCollectChild.
  // "blocked" → never overridden. "flag" → override allowed (with audit trail).
  // If no collector identified, skip (the override IS the authorisation).
  if (collectorPersonId) {
    const decision = await canCollectChild(
      { id: collectorPersonId },
      { id: childPersonId },
    );
    if (decision.reason === "blacklisted") {
      await logAudit({
        actorUserId: user.id,
        action: "checkout.override.blocked",
        entity: "Person",
        entityId: childPersonId,
        details: {
          childPersonId,
          collectorPersonId,
          blacklistEntryId: decision.blacklistEntry?.id ?? null,
          blacklistReason: decision.blacklistEntry?.reason ?? null,
        },
        ip: getClientIp(req),
      });
      return NextResponse.json(
        {
          error: "forbidden",
          message:
            "This collector is blacklisted with 'blocked' severity — override is not permitted. Contact security.",
          reason: "blacklisted",
          blacklistEntryId: decision.blacklistEntry?.id ?? null,
        },
        { status: 403 },
      );
    }
  }

  // Check out every open record + write OverrideCheckoutLog per record.
  const checkedOut: { checkInRecordId: string; sessionId: string }[] = [];
  await db.$transaction(async (tx) => {
    for (const rec of openRecords) {
      await tx.checkInRecord.update({
        where: { id: rec.id },
        data: {
          checkedOutAt: new Date(),
          checkedOutByPersonId: collectorPersonId ?? null,
          checkedOutByUserId: user.id,
          checkoutMethod: "override",
          overrideNote: note,
          photoVerified: flags.photo_verification ? true : null,
        },
      });
      await tx.overrideCheckoutLog.create({
        data: {
          checkInRecordId: rec.id,
          childPersonId,
          collectorPersonId: collectorPersonId ?? null,
          authorisingUserId: user.id,
          note,
          confirmed: true,
        },
      });
      checkedOut.push({
        checkInRecordId: rec.id,
        sessionId: rec.checkInSession.id,
      });
    }
  });

  // Resolve child name.
  const child = await db.person.findUnique({
    where: { id: childPersonId },
    select: { firstName: true, lastName: true },
  });
  const childName = child
    ? `${child.firstName} ${child.lastName}`
    : childPersonId;

  await logAudit({
    actorUserId: user.id,
    action: "checkout.override",
    entity: "Person",
    entityId: childPersonId,
    details: {
      childPersonId,
      childName,
      collectorPersonId: collectorPersonId ?? null,
      note,
      checkedOutCount: checkedOut.length,
      records: checkedOut.map((c) => c.checkInRecordId),
    },
    ip: getClientIp(req),
  });

  // Broadcast to all relevant rooms.
  const allRooms = new Set<string>();
  for (const rec of openRecords) {
    for (const r of roomsForScope({
      roomId: rec.roomId,
      classId: rec.classId,
      programId: rec.checkInSession.programId,
      checkInSessionId: rec.checkInSession.id,
    })) {
      allRooms.add(r);
    }
  }
  await broadcastRealtime({
    event: "checkout:update",
    rooms: Array.from(allRooms),
    payload: {
      childPersonId,
      checkInRecordIds: checkedOut.map((c) => c.checkInRecordId),
      method: "override",
      note,
    },
  });

  return NextResponse.json({
    ok: true,
    checkedOut,
    count: checkedOut.length,
  });
}
