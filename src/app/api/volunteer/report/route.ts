import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { startOfDayUTC } from "@/lib/daily-code";

export const dynamic = "force-dynamic";

/**
 * GET /api/volunteer/report?programId=&classId=&roomId=&dateFrom=&dateTo=&format=
 *
 * Attendance report for a scope + date range.
 *
 * Access: Teacher / Volunteer / Security / Admin (run_reports permission).
 *
 * Query params:
 *   - programId, classId, roomId (optional filters — any combination)
 *   - dateFrom (yyyy-mm-dd, defaults to today)
 *   - dateTo (yyyy-mm-dd, defaults to dateFrom)
 *   - format: "json" (default) | "csv"
 *
 * JSON returns:
 *   {
 *     scope: { programId, classId, roomId, dateFrom, dateTo },
 *     summary: { totalCheckIns, uniqueChildren, stillInCare, checkedOut, withAlerts },
 *     items: [{ checkInRecordId, child, family, program, class, room,
 *              checkedInAt, checkedOutAt, durationMinutes, method,
 *              checkoutMethod, hasAlerts }]
 *   }
 *
 * CSV returns:
 *   text/csv with columns: Child,Family,Program,Class,Room,CheckedIn,CheckedOut,Duration(min),Method,CheckoutMethod,Allergies,MedicalNotes
 *   Content-Disposition: attachment; filename="attendance-report-YYYYMMDD-YYYYMMDD.csv"
 */
function parseDate(s: string | null, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return fallback;
  return d;
}

function csvEscape(s: string | null | undefined): string {
  if (s == null) return "";
  const str = String(s);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(user.roles, "run_reports")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const programId = url.searchParams.get("programId")?.trim() || null;
  const classId = url.searchParams.get("classId")?.trim() || null;
  const roomId = url.searchParams.get("roomId")?.trim() || null;
  const format = url.searchParams.get("format")?.trim() || "json";

  const today = new Date();
  const dateFrom = startOfDayUTC(parseDate(url.searchParams.get("dateFrom"), today));
  const dateToRaw = parseDate(url.searchParams.get("dateTo"), dateFrom);
  // dateTo end-of-day.
  const dateTo = startOfDayUTC(dateToRaw);
  dateTo.setUTCDate(dateTo.getUTCDate() + 1);

  // Build the WHERE clause.
  const where: Record<string, unknown> = {
    checkedInAt: { gte: dateFrom, lt: dateTo },
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

  // CheckInRecord has no relation to Person or Family — resolve separately.
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
            allergies: true,
            medicalNotes: true,
            dateOfBirth: true,
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

  // Resolve class + room + program names.
  const classIds = Array.from(
    new Set(records.map((r) => r.classId).filter((x): x is string => !!x)),
  );
  const roomIds = Array.from(
    new Set(records.map((r) => r.roomId).filter((x): x is string => !!x)),
  );
  const programIds = Array.from(
    new Set(
      records
        .map((r) => r.checkInSession.programId)
        .filter((x): x is string => !!x),
    ),
  );
  const [classes, rooms, programs] = await Promise.all([
    classIds.length
      ? db.groupClass.findMany({
          where: { id: { in: classIds } },
          select: { id: true, name: true, programId: true },
        })
      : Promise.resolve([]),
    roomIds.length
      ? db.room.findMany({
          where: { id: { in: roomIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    programIds.length
      ? db.program.findMany({
          where: { id: { in: programIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const classById = new Map(classes.map((c) => [c.id, c]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const programById = new Map(programs.map((p) => [p.id, p]));

  const items = records
    .map((r) => {
      const child = childById.get(r.childPersonId);
      const family = familyById.get(r.familyId);
      if (!child || !family) return null;
      const cls = r.classId ? classById.get(r.classId) : undefined;
      const program = cls
        ? programById.get(cls.programId)
        : r.checkInSession.programId
          ? programById.get(r.checkInSession.programId)
          : undefined;
      const room = r.roomId ? roomById.get(r.roomId) : undefined;
      const checkedInAt = r.checkedInAt;
      const checkedOutAt = r.checkedOutAt;
      const durationMinutes =
        checkedOutAt != null
          ? Math.round(
              (checkedOutAt.getTime() - checkedInAt.getTime()) / 60000,
            )
          : null;
      return {
        checkInRecordId: r.id,
        childPersonId: child.id,
        childName: `${child.firstName} ${child.lastName}`,
        familyId: family.id,
        familyName: family.familyName,
        programId: program?.id ?? r.checkInSession.programId ?? null,
        programName: program?.name ?? null,
        classId: r.classId,
        className: cls?.name ?? null,
        roomId: r.roomId,
        roomName: room?.name ?? null,
        checkedInAt: checkedInAt.toISOString(),
        checkedOutAt: checkedOutAt ? checkedOutAt.toISOString() : null,
        durationMinutes,
        method: r.method,
        checkoutMethod: r.checkoutMethod,
        overrideNote: r.overrideNote,
        hasAlerts:
          (!!child.allergies && child.allergies.trim().length > 0) ||
          (!!child.medicalNotes && child.medicalNotes.trim().length > 0),
        allergies: child.allergies,
        medicalNotes: child.medicalNotes,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const summary = {
    totalCheckIns: items.length,
    uniqueChildren: new Set(items.map((i) => i.childPersonId)).size,
    stillInCare: items.filter((i) => i.checkedOutAt === null).length,
    checkedOut: items.filter((i) => i.checkedOutAt !== null).length,
    withAlerts: items.filter((i) => i.hasAlerts).length,
  };

  const scope = {
    programId,
    classId,
    roomId,
    dateFrom: dateFrom.toISOString(),
    dateTo: startOfDayUTC(dateToRaw).toISOString(),
  };

  if (format === "csv") {
    const header = [
      "Child",
      "Family",
      "Program",
      "Class",
      "Room",
      "CheckedIn",
      "CheckedOut",
      "Duration(min)",
      "Method",
      "CheckoutMethod",
      "Allergies",
      "MedicalNotes",
    ];
    const rows = items.map((i) =>
      [
        i.childName,
        i.familyName,
        i.programName ?? "",
        i.className ?? "",
        i.roomName ?? "",
        i.checkedInAt,
        i.checkedOutAt ?? "",
        i.durationMinutes ?? "",
        i.method,
        i.checkoutMethod ?? "",
        i.allergies ?? "",
        i.medicalNotes ?? "",
      ]
        .map((v) => csvEscape(String(v)))
        .join(","),
    );
    const csv = [header.join(","), ...rows].join("\n");
    const fromTag = dateFrom.toISOString().slice(0, 10).replace(/-/g, "");
    const toTag = startOfDayUTC(dateToRaw)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendance-report-${fromTag}-${toTag}.csv"`,
      },
    });
  }

  return NextResponse.json({ scope, summary, items });
}
