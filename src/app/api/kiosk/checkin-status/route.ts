import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { startOfDayUTC } from "@/lib/daily-code";

export const dynamic = "force-dynamic";

/**
 * GET /api/kiosk/checkin-status?familyId=<id>
 *
 * Returns, for each child in the family, whether they are currently checked
 * in (to ANY session today, not yet checked out). Used by the family detail
 * page to render a "Currently checked in ✓" badge and by the check-in flow
 * to disable already-checked-in children.
 *
 * Public to the kiosk (same gate as the kiosk family detail page itself —
 * i.e. respects kiosk_requires_login at the page level, not here).
 *
 * Returns: { items: [{ childPersonId, checkedIn: boolean, sessionId, programId, eventId, className, roomName, dailyCode, checkedInAt }] }
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const familyId = (url.searchParams.get("familyId") ?? "").trim();
  if (!familyId) {
    return NextResponse.json(
      { error: "validation", message: "familyId required" },
      { status: 400 },
    );
  }

  const today = new Date();
  const dayStart = startOfDayUTC(today);
  // End of today (UTC).
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  // Find today's sessions for this family's check-ins.
  const records = await db.checkInRecord.findMany({
    where: {
      familyId,
      checkedInAt: { gte: dayStart, lt: dayEnd },
      checkedOutAt: null,
    },
    include: {
      checkInSession: {
        select: {
          id: true,
          programId: true,
          eventId: true,
          sessionDate: true,
        },
      },
      // Lazy-load class name + room name for display.
      // (roomId is denormalised on the record but class name + room name
      // require a join — we do it here rather than denormalising strings.)
    },
    orderBy: { checkedInAt: "desc" },
  });

  // For className/roomName lookups (only if classId set).
  const classIds = Array.from(
    new Set(records.map((r) => r.classId).filter((x): x is string => !!x)),
  );
  const classes = classIds.length
    ? await db.groupClass.findMany({
        where: { id: { in: classIds } },
        select: { id: true, name: true, room: { select: { name: true } } },
      })
    : [];
  const classById = new Map(classes.map((c) => [c.id, c]));

  const items = records.map((r) => ({
    checkInRecordId: r.id,
    childPersonId: r.childPersonId,
    checkedIn: true,
    sessionId: r.checkInSession.id,
    programId: r.checkInSession.programId,
    eventId: r.checkInSession.eventId,
    classId: r.classId,
    className: r.classId ? classById.get(r.classId)?.name ?? null : null,
    roomName: r.classId ? classById.get(r.classId)?.room?.name ?? null : null,
    method: r.method,
    dailyCode: r.dailyCode,
    checkedInAt: r.checkedInAt.toISOString(),
    checkedInByPersonId: r.checkedInByPersonId,
  }));

  return NextResponse.json({ items });
}
