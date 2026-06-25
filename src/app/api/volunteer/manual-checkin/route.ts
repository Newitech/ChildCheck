import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { startOfDayUTC, getOrCreateDailyCode } from "@/lib/daily-code";
import { logAudit } from "@/lib/audit";
import { broadcastRealtime, roomsForScope } from "@/lib/realtime";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/volunteer/manual-checkin
 *
 * A teacher / volunteer manually checks in a single child. Used when a child
 * arrives late or was missed by the kiosk flow. The teacher is trusted — no
 * guardian PIN or daily code authorisation is required; the teacher's session
 * IS the authorisation.
 *
 * Access: Teacher / Volunteer / Admin (check_in permission). Security does not
 * have check_in by default.
 *
 * Body:
 *   {
 *     childPersonId: string,
 *     programId: string | null,   // exactly one of programId / eventId
 *     eventId: string | null,
 *     classId?: string | null,    // optional, must belong to program if set
 *     reason: string              // mandatory (min 3 chars) — why a manual check-in
 *   }
 *
 * Returns:
 *   200 { ok, checkInRecordId, sessionId, dailyCode, child }
 *   400 { error: "validation" }
 *   401 { error: "unauthorized" }
 *   403 { error: "forbidden" }
 *   404 { error: "not_found" }
 *   409 { error: "already_checked_in" }
 */
const bodySchema = z.object({
  childPersonId: z.string().min(1),
  programId: z.string().min(1).nullable(),
  eventId: z.string().min(1).nullable(),
  classId: z.string().min(1).nullable().optional(),
  reason: z.string().trim().min(3).max(500),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(user.roles, "check_in")) {
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
  const { childPersonId, programId, eventId, classId, reason } = parsed.data;

  // Exactly one of programId / eventId.
  if ((programId && eventId) || (!programId && !eventId)) {
    return NextResponse.json(
      { error: "validation", message: "Exactly one of programId/eventId must be set" },
      { status: 400 },
    );
  }

  // Resolve the child + their family.
  const membership = await db.familyMember.findFirst({
    where: {
      personId: childPersonId,
      role: "Child",
      person: { personType: "Child", isActive: true },
    },
    include: {
      family: { select: { id: true, familyName: true } },
      person: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          allergies: true,
          medicalNotes: true,
        },
      },
    },
  });
  if (!membership) {
    return NextResponse.json(
      { error: "not_found", message: "Child not found" },
      { status: 404 },
    );
  }
  const familyId = membership.family.id;

  // Validate program/event.
  let program: { id: string; name: string } | null = null;
  let eventObj: { id: string; name: string } | null = null;
  if (programId) {
    program = await db.program.findUnique({
      where: { id: programId, isActive: true },
      select: { id: true, name: true },
    });
    if (!program) {
      return NextResponse.json(
        { error: "not_found", message: "Program not found" },
        { status: 404 },
      );
    }
  } else if (eventId) {
    eventObj = await db.event.findUnique({
      where: { id: eventId, isActive: true },
      select: { id: true, name: true },
    });
    if (!eventObj) {
      return NextResponse.json(
        { error: "not_found", message: "Event not found" },
        { status: 404 },
      );
    }
  }

  // Validate classId belongs to the program (if set).
  let classMeta:
    | { id: string; name: string; roomId: string | null; roomName: string | null }
    | null = null;
  if (classId) {
    if (!programId) {
      return NextResponse.json(
        { error: "validation", message: "classId only valid with programId (events have no classes)" },
        { status: 400 },
      );
    }
    const cls = await db.groupClass.findFirst({
      where: { id: classId, programId, isActive: true },
      select: { id: true, name: true, roomId: true, room: { select: { name: true } } },
    });
    if (!cls) {
      return NextResponse.json(
        { error: "validation", message: "class does not belong to program" },
        { status: 400 },
      );
    }
    classMeta = {
      id: cls.id,
      name: cls.name,
      roomId: cls.roomId,
      roomName: cls.room?.name ?? null,
    };
  }

  const today = new Date();
  const sessionDate = startOfDayUTC(today);

  // Generate the daily code (idempotent — gets existing if family already
  // checked in today).
  const dailyCode = await getOrCreateDailyCode(familyId, today);

  // Get-or-create the session + the check-in record (idempotent — if the child
  // is already checked in to this session today and not yet checked out, we
  // return a 409 so the UI can show a friendly message).
  const result = await db.$transaction(async (tx) => {
    const session = programId
      ? await tx.checkInSession.upsert({
          where: { programId_sessionDate: { programId, sessionDate } },
          create: { programId, eventId: null, sessionDate },
          update: {},
          select: { id: true },
        })
      : await tx.checkInSession.upsert({
          where: { eventId_sessionDate: { eventId: eventId!, sessionDate } },
          create: { programId: null, eventId: eventId!, sessionDate },
          update: {},
          select: { id: true },
        });

    // Check for an existing open record for this child in this session.
    const existing = await tx.checkInRecord.findFirst({
      where: {
        checkInSessionId: session.id,
        childPersonId,
        checkedOutAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      return { kind: "already" as const, sessionId: session.id };
    }

    const rec = await tx.checkInRecord.create({
      data: {
        checkInSessionId: session.id,
        childPersonId,
        familyId,
        classId: classMeta?.id ?? null,
        roomId: classMeta?.roomId ?? null,
        checkedInByPersonId: null,
        checkedInByUserId: user.id,
        method: "teacher",
        dailyCode,
        labelPrinted: false,
      },
      select: { id: true },
    });
    return { kind: "ok" as const, sessionId: session.id, checkInRecordId: rec.id };
  });

  if (result.kind === "already") {
    return NextResponse.json(
      { error: "already_checked_in", sessionId: result.sessionId },
      { status: 409 },
    );
  }

  await logAudit({
    actorUserId: user.id,
    action: "checkin.manual",
    entity: program ? "Program" : "Event",
    entityId: programId ?? eventId ?? null,
    details: {
      childPersonId,
      familyId,
      sessionDate: sessionDate.toISOString(),
      sessionId: result.sessionId,
      method: "teacher",
      dailyCode,
      reason,
      classId: classMeta?.id ?? null,
      hasAlerts:
        (!!membership.person.allergies &&
          membership.person.allergies.trim().length > 0) ||
        (!!membership.person.medicalNotes &&
          membership.person.medicalNotes.trim().length > 0),
    },
    ip: getClientIp(req),
  });

  await broadcastRealtime({
    event: "checkin:update",
    rooms: roomsForScope({
      roomId: classMeta?.roomId ?? null,
      classId: classMeta?.id ?? null,
      programId,
      checkInSessionId: result.sessionId,
    }),
    payload: {
      checkInRecordId: result.checkInRecordId,
      childPersonId,
      familyId,
      roomId: classMeta?.roomId ?? null,
      classId: classMeta?.id ?? null,
      programId,
      checkInSessionId: result.sessionId,
      method: "teacher",
      dailyCode,
    },
  });

  return NextResponse.json({
    ok: true,
    checkInRecordId: result.checkInRecordId,
    sessionId: result.sessionId,
    dailyCode,
    child: {
      id: membership.person.id,
      firstName: membership.person.firstName,
      lastName: membership.person.lastName,
    },
    classId: classMeta?.id ?? null,
    className: classMeta?.name ?? null,
    roomName: classMeta?.roomName ?? null,
  });
}
