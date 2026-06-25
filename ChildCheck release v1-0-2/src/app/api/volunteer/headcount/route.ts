import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { startOfDayUTC } from "@/lib/daily-code";
import { logAudit } from "@/lib/audit";
import { broadcastRealtime, roomsForScope } from "@/lib/realtime";
import { getClientIp } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * POST /api/volunteer/headcount
 *
 * Records a manual headcount for a scope (room, class, or check-in session).
 * Compares the recorded count to the actual checked-in count for that scope on
 * today's date and returns the discrepancy.
 *
 * Access: Teacher / Volunteer / Security / Admin (headcount permission).
 *
 * Body:
 *   { roomId?, classId?, checkInSessionId?, count: int, notes? }
 *   At least one of roomId / classId / checkInSessionId must be set.
 *
 * Returns:
 *   200 { ok, id, recorded, expected, discrepancy, scope }
 *   400 { error: "validation" }
 *   401 { error: "unauthorized" }
 *   403 { error: "forbidden" }
 */
const bodySchema = z.object({
  roomId: z.string().min(1).nullable().optional(),
  classId: z.string().min(1).nullable().optional(),
  checkInSessionId: z.string().min(1).nullable().optional(),
  count: z.number().int().min(0).max(9999),
  notes: z.string().max(2000).nullable().optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(user.roles, "headcount")) {
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
  const { roomId, classId, checkInSessionId, count, notes } = parsed.data;

  // At least one scope must be set.
  if (!roomId && !classId && !checkInSessionId) {
    return NextResponse.json(
      {
        error: "validation",
        message: "At least one of roomId / classId / checkInSessionId required",
      },
      { status: 400 },
    );
  }

  const today = new Date();
  const dayStart = startOfDayUTC(today);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  // Compute the actual checked-in count for the scope (records still open
  // today). Apply the same filters we'd apply to the roster.
  const where: Record<string, unknown> = {
    checkedInAt: { gte: dayStart, lt: dayEnd },
    checkedOutAt: null,
  };
  if (roomId) where.roomId = roomId;
  if (classId) where.classId = classId;
  if (checkInSessionId) where.checkInSessionId = checkInSessionId;

  const expected = await db.checkInRecord.count({ where });

  // Persist the headcount log.
  const log = await db.headcountLog.create({
    data: {
      roomId: roomId ?? null,
      classId: classId ?? null,
      checkInSessionId: checkInSessionId ?? null,
      count,
      reportedById: user.id,
      notes: notes ?? null,
    },
  });

  const discrepancy = count - expected;

  await logAudit({
    actorUserId: user.id,
    action: "headcount.record",
    entity: "HeadcountLog",
    entityId: log.id,
    details: {
      roomId: roomId ?? null,
      classId: classId ?? null,
      checkInSessionId: checkInSessionId ?? null,
      count,
      expected,
      discrepancy,
      notes: notes ?? null,
    },
    ip: getClientIp(req),
  });

  // Broadcast to realtime subscribers.
  await broadcastRealtime({
    event: "headcount:update",
    rooms: roomsForScope({ roomId, classId, checkInSessionId }),
    payload: {
      id: log.id,
      roomId: roomId ?? null,
      classId: classId ?? null,
      checkInSessionId: checkInSessionId ?? null,
      count,
      expected,
      discrepancy,
      recordedAt: log.createdAt.toISOString(),
      reportedBy: user.id,
    },
  });

  return NextResponse.json({
    ok: true,
    id: log.id,
    recorded: count,
    expected,
    discrepancy,
    recordedAt: log.createdAt.toISOString(),
    scope: {
      roomId: roomId ?? null,
      classId: classId ?? null,
      checkInSessionId: checkInSessionId ?? null,
    },
  });
}
