import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { startOfDayUTC } from "@/lib/daily-code";

export const dynamic = "force-dynamic";

/**
 * GET /api/volunteer/roster?roomId=&classId=&programId=&date=
 *
 * Returns the currently-checked-in children for the requested scope on the
 * requested date (defaults to today). "Currently checked in" = CheckInRecord
 * with checkedInAt within the day AND checkedOutAt IS NULL.
 *
 * Access: Teacher / Volunteer / Security / Admin (view_roster permission).
 *
 * Query params:
 *   - roomId (optional) — restrict to children checked in to this room
 *   - classId (optional) — restrict to children checked in to this class
 *   - programId (optional) — restrict to children checked in to this program's
 *     sessions today
 *   - date (optional, ISO yyyy-mm-dd) — defaults to today
 *
 * The response includes child name, age, family name, class, room, checkedInAt,
 * and allergy/medical DETAILS (teachers need this for safety — they have a
 * duty of care). The Stage 3 "strip medical fields from list responses" rule
 * is deliberately relaxed here for teachers/volunteers with view_roster —
 * they cannot safely care for children without knowing their allergies.
 *
 * Returns: { items: RosterChild[], scope: { roomId, classId, programId, date } }
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(user.roles, "view_roster")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const roomId = url.searchParams.get("roomId")?.trim() || null;
  const classId = url.searchParams.get("classId")?.trim() || null;
  const programId = url.searchParams.get("programId")?.trim() || null;
  const dateParam = url.searchParams.get("date")?.trim() || null;
  const date = dateParam ? new Date(dateParam) : new Date();
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json(
      { error: "validation", message: "Invalid date (use ISO yyyy-mm-dd)" },
      { status: 400 },
    );
  }
  const dayStart = startOfDayUTC(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  // Build the WHERE clause for CheckInRecord.
  // - checkedInAt within [dayStart, dayEnd)
  // - checkedOutAt IS NULL (still in care)
  // - scope filters
  const where: Record<string, unknown> = {
    checkedInAt: { gte: dayStart, lt: dayEnd },
    checkedOutAt: null,
  };
  if (roomId) where.roomId = roomId;
  if (classId) where.classId = classId;
  if (programId) {
    where.checkInSession = { programId };
  }

  const records = await db.checkInRecord.findMany({
    where,
    include: {
      checkInSession: {
        select: {
          id: true,
          programId: true,
          eventId: true,
        },
      },
    },
    orderBy: { checkedInAt: "asc" },
  });

  // CheckInRecord has no relation to Person or Family (only to CheckInSession).
  // Resolve child Persons + Families separately.
  const childIds = Array.from(new Set(records.map((r) => r.childPersonId)));
  const familyIds = Array.from(new Set(records.map((r) => r.familyId)));
  const [children, families] = await Promise.all([
    childIds.length
      ? db.person.findMany({
          where: { id: { in: childIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            dateOfBirth: true,
            photoPath: true,
            allergies: true,
            medicalNotes: true,
            dietaryNotes: true,
            isVisitor: true,
          },
        })
      : Promise.resolve([]),
    familyIds.length
      ? db.family.findMany({
          where: { id: { in: familyIds } },
          select: { id: true, familyName: true },
        })
      : Promise.resolve([]),
  ]);
  const childById = new Map(children.map((c) => [c.id, c]));
  const familyById = new Map(families.map((f) => [f.id, f]));

  // Resolve class + room names (denormalised IDs on the record, names via join).
  const classIds = Array.from(
    new Set(records.map((r) => r.classId).filter((x): x is string => !!x)),
  );
  const roomIds = Array.from(
    new Set(records.map((r) => r.roomId).filter((x): x is string => !!x)),
  );
  const [classes, rooms] = await Promise.all([
    classIds.length
      ? db.groupClass.findMany({
          where: { id: { in: classIds } },
          select: {
            id: true,
            name: true,
            programId: true,
            program: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
    roomIds.length
      ? db.room.findMany({
          where: { id: { in: roomIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const classById = new Map(classes.map((c) => [c.id, c]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  function ageYears(dob: Date | null): number | null {
    if (!dob) return null;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return age >= 0 ? age : null;
  }

  const items = records
    .map((r) => {
      const child = childById.get(r.childPersonId);
      const family = familyById.get(r.familyId);
      if (!child || !family) return null;
      const cls = r.classId ? classById.get(r.classId) : undefined;
      const room = r.roomId ? roomById.get(r.roomId) : undefined;
      const age = ageYears(child.dateOfBirth);
      return {
        checkInRecordId: r.id,
        childPersonId: child.id,
        firstName: child.firstName,
        lastName: child.lastName,
        preferredName: child.preferredName,
        fullName: `${child.firstName} ${child.lastName}`,
        ageYears: age,
        dateOfBirth: child.dateOfBirth
          ? child.dateOfBirth.toISOString()
          : null,
        isVisitor: child.isVisitor,
        hasPhoto: !!child.photoPath,
        photoPath: child.photoPath,
        // SAFETY: teachers/volunteers with view_roster see allergy/medical details
        // for children currently in their care. They need this information to
        // respond appropriately in an emergency. (Stripped from kiosk list views.)
        allergies: child.allergies,
        medicalNotes: child.medicalNotes,
        dietaryNotes: child.dietaryNotes,
        hasAlerts:
          (!!child.allergies && child.allergies.trim().length > 0) ||
          (!!child.medicalNotes && child.medicalNotes.trim().length > 0),
        familyId: family.id,
        familyName: family.familyName,
        classId: r.classId,
        className: cls?.name ?? null,
        programId: cls?.programId ?? r.checkInSession.programId,
        programName: cls?.program.name ?? null,
        roomId: r.roomId,
        roomName: room?.name ?? null,
        checkInSessionId: r.checkInSession.id,
        eventId: r.checkInSession.eventId,
        checkedInAt: r.checkedInAt.toISOString(),
        method: r.method,
        dailyCode: r.dailyCode,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({
    items,
    scope: {
      roomId,
      classId,
      programId,
      date: dayStart.toISOString(),
    },
    count: items.length,
  });
}
