import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { startOfDayUTC } from "@/lib/daily-code";

export const dynamic = "force-dynamic";

/**
 * GET /api/volunteer/headcounts?roomId=&classId=&date=
 *
 * Lists headcount logs for a scope + date (defaults to today). Used by the
 * volunteer dashboard to show recent headcount history per scope.
 *
 * Access: Teacher / Volunteer / Security / Admin (headcount permission).
 *
 * Returns: { items: HeadcountLogDTO[], scope: {...} }
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(user.roles, "headcount")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const roomId = url.searchParams.get("roomId")?.trim() || null;
  const classId = url.searchParams.get("classId")?.trim() || null;
  const dateParam = url.searchParams.get("date")?.trim() || null;
  const date = dateParam ? new Date(dateParam) : new Date();
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json(
      { error: "validation", message: "Invalid date" },
      { status: 400 },
    );
  }
  const dayStart = startOfDayUTC(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  if (!roomId && !classId) {
    return NextResponse.json(
      { error: "validation", message: "roomId or classId required" },
      { status: 400 },
    );
  }

  const where: Prisma.HeadcountLogWhereInput = {
    createdAt: { gte: dayStart, lt: dayEnd },
  };
  if (roomId) where.roomId = roomId;
  if (classId) where.classId = classId;

  const logs = await db.headcountLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    // reportedById → user → person for the reporter's name
    // (we don't model a back-relation from HeadcountLog to User to keep the
    // schema lean; do a manual lookup below if needed)
  });

  // Resolve reporter names in one query.
  const reporterIds = Array.from(new Set(logs.map((l) => l.reportedById)));
  const reporters = reporterIds.length
    ? await db.user.findMany({
        where: { id: { in: reporterIds } },
        select: {
          id: true,
          person: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const reporterNameById = new Map(
    reporters.map((r) => [
      r.id,
      `${r.person.firstName} ${r.person.lastName}`,
    ]),
  );

  // For each log, also compute the expected count at the time of recording
  // (we can't easily reconstruct historical state, so we report the CURRENT
  // expected count as a reference — the discrepancy stored with the log was
  // the snapshot at the time of recording, computed in the POST handler).
  const items = logs.map((l) => ({
    id: l.id,
    roomId: l.roomId,
    classId: l.classId,
    checkInSessionId: l.checkInSessionId,
    count: l.count,
    notes: l.notes,
    createdAt: l.createdAt.toISOString(),
    reportedById: l.reportedById,
    reportedByName: reporterNameById.get(l.reportedById) ?? l.reportedById,
  }));

  return NextResponse.json({
    items,
    scope: {
      roomId,
      classId,
      date: dayStart.toISOString(),
    },
  });
}
