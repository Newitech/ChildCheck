import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { broadcastRealtime, roomsForScope } from "@/lib/realtime";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/volunteer/manual-checkout
 *
 * A teacher / volunteer manually checks out a single child. Used when a child
 * is collected informally (e.g. parent walks up to the teacher) or the kiosk
 * is unavailable. The teacher is trusted — no code/PIN required; the teacher's
 * session IS the authorisation.
 *
 * Access: Teacher / Volunteer / Admin (check_out permission). Security does
 * NOT have check_out by default — they should use the override flow.
 *
 * Body:
 *   {
 *     childPersonId: string,
 *     reason: string                  // mandatory (min 3 chars)
 *     checkInRecordId?: string | null // optional — if set, only this record is checked out.
 *                                     // If null/omitted, ALL open records for this child today
 *                                     // are checked out.
 *   }
 *
 * Returns:
 *   200 { ok, checkedOut: [{ checkInRecordId, sessionId }], count }
 *   400 { error: "validation" }
 *   401 { error: "unauthorized" }
 *   403 { error: "forbidden" }
 *   404 { error: "not_found" }
 */
const bodySchema = z.object({
  childPersonId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
  checkInRecordId: z.string().min(1).nullable().optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(user.roles, "check_out")) {
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
  const { childPersonId, reason, checkInRecordId } = parsed.data;

  // Find the open record(s) for this child today.
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
      checkInSession: {
        select: { id: true, programId: true, eventId: true },
      },
    },
  });

  if (openRecords.length === 0) {
    return NextResponse.json(
      { error: "not_found", message: "No open check-in record found for this child" },
      { status: 404 },
    );
  }

  // Update them all in a transaction.
  const checkedOut: { checkInRecordId: string; sessionId: string }[] = [];
  await db.$transaction(async (tx) => {
    for (const rec of openRecords) {
      await tx.checkInRecord.update({
        where: { id: rec.id },
        data: {
          checkedOutAt: new Date(),
          checkedOutByPersonId: null,
          checkedOutByUserId: user.id,
          checkoutMethod: "teacher",
          overrideNote: `Manual teacher checkout: ${reason}`,
          photoVerified: null,
        },
      });
      checkedOut.push({
        checkInRecordId: rec.id,
        sessionId: rec.checkInSession.id,
      });
    }
  });

  // Resolve child name for audit.
  const child = await db.person.findUnique({
    where: { id: childPersonId },
    select: { firstName: true, lastName: true },
  });
  const childName = child
    ? `${child.firstName} ${child.lastName}`
    : childPersonId;

  await logAudit({
    actorUserId: user.id,
    action: "checkout.manual",
    entity: "Person",
    entityId: childPersonId,
    details: {
      childPersonId,
      childName,
      reason,
      checkedOutCount: checkedOut.length,
      records: checkedOut.map((c) => c.checkInRecordId),
    },
    ip: getClientIp(req),
  });

  // Broadcast to all relevant rooms (the child's records may span multiple
  // rooms/classes/programs — notify every scope).
  const allRooms = new Set<string>();
  for (const rec of openRecords) {
    for (const r of roomsForScope({
      roomId: rec.roomId,
      classId: rec.classId,
      programId: rec.checkInSession.programId,
      eventId: rec.checkInSession.eventId,
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
      method: "teacher",
    },
  });

  return NextResponse.json({
    ok: true,
    checkedOut,
    count: checkedOut.length,
  });
}
