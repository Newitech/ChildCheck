import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { buildCsv, csvResponseHeaders, type CsvValue } from "@/lib/csv";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { parseDateParam, isoDay } from "@/lib/reports-shared";
import { startOfDayUTC } from "@/lib/daily-code";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/export
 *   ?type=(people|families|attendance|audit)&format=csv
 *   &dateFrom=&dateTo=      (attendance + audit only)
 *
 * Exports the named list as an RFC-4180 CSV attachment.
 *
 * Requires Admin / PeopleManager (the spec says both are acceptable; Admin
 * always passes, PeopleManager has view_people + manage_people + manage_families).
 *
 * Attendance + audit additionally accept Security (admin-side triad).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const isAdminLike =
    user.roles.includes("Admin") ||
    user.roles.includes("PeopleManager") ||
    user.roles.includes("Security");
  if (!isAdminLike) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "").trim();
  const format = (url.searchParams.get("format") ?? "csv").trim().toLowerCase();

  if (format !== "csv") {
    return NextResponse.json(
      { error: `Unsupported format "${format}". Only "csv" is supported.` },
      { status: 400 },
    );
  }

  if (type === "people") {
    return await exportPeopleCsv(user.id);
  }
  if (type === "families") {
    return await exportFamiliesCsv(user.id);
  }
  if (type === "attendance") {
    return await exportAttendanceCsv(req, user.id);
  }
  if (type === "audit") {
    return await exportAuditCsv(req, user.id);
  }
  return NextResponse.json(
    { error: `Unknown export type "${type}". Expected one of: people, families, attendance, audit.` },
    { status: 400 },
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

async function exportPeopleCsv(actorUserId: string) {
  const rows = await db.person.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const header = [
    "id",
    "firstName",
    "lastName",
    "preferredName",
    "personType",
    "email",
    "phone",
    "dateOfBirth",
    "gender",
    "schoolGrade",
    "isVisitor",
    "isActive",
    "allergies",
    "medicalNotes",
    "dietaryNotes",
    "emergencyContactName",
    "emergencyContactPhone",
  ];

  const csvRows: CsvValue[][] = rows.map((p) => [
    p.id,
    p.firstName,
    p.lastName,
    p.preferredName ?? "",
    p.personType,
    p.email ?? "",
    p.phone ?? "",
    p.dateOfBirth ? isoDay(p.dateOfBirth) : "",
    p.gender ?? "",
    p.schoolGrade ?? "",
    p.isVisitor ? "true" : "false",
    p.isActive ? "true" : "false",
    p.allergies ?? "",
    p.medicalNotes ?? "",
    p.dietaryNotes ?? "",
    p.emergencyContactName ?? "",
    p.emergencyContactPhone ?? "",
  ]);

  const csv = buildCsv(header, csvRows);

  await logAudit({
    actorUserId,
    action: "export.people",
    entity: "Person",
    details: { count: rows.length, format: "csv" },
  });

  return new NextResponse(csv, {
    status: 200,
    headers: csvResponseHeaders(`people-${todayTag()}.csv`),
  });
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

async function exportFamiliesCsv(actorUserId: string) {
  const families = await db.family.findMany({
    orderBy: [{ familyName: "asc" }],
    include: {
      members: {
        include: {
          person: {
            select: { firstName: true, lastName: true, personType: true },
          },
        },
      },
    },
  });

  const header = [
    "id",
    "familyName",
    "notes",
    "isActive",
    "primaryCarers",
    "children",
    "guardians",
    "memberCount",
  ];

  const csvRows: CsvValue[][] = families.map((f) => {
    const carers = f.members
      .filter((m) => m.role === "PrimaryCarer")
      .map((m) => `${m.person.firstName} ${m.person.lastName}`)
      .join("; ");
    const children = f.members
      .filter((m) => m.role === "Child")
      .map((m) => `${m.person.firstName} ${m.person.lastName}`)
      .join("; ");
    const guardians = f.members
      .filter((m) => m.role === "AuthorisedGuardian")
      .map((m) => `${m.person.firstName} ${m.person.lastName}`)
      .join("; ");
    return [
      f.id,
      f.familyName,
      f.notes ?? "",
      f.isActive ? "true" : "false",
      carers,
      children,
      guardians,
      f.members.length,
    ];
  });

  const csv = buildCsv(header, csvRows);

  await logAudit({
    actorUserId,
    action: "export.families",
    entity: "Family",
    details: { count: families.length, format: "csv" },
  });

  return new NextResponse(csv, {
    status: 200,
    headers: csvResponseHeaders(`families-${todayTag()}.csv`),
  });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

async function exportAttendanceCsv(req: Request, actorUserId: string) {
  const url = new URL(req.url);
  const fromParam = parseDateParam(url.searchParams.get("dateFrom"));
  const toParam = parseDateParam(url.searchParams.get("dateTo"));

  const today = startOfDayUTC(new Date());
  const dateFrom = fromParam ? startOfDayUTC(fromParam) : (() => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - 29);
    return d;
  })();
  const toRaw = toParam ? startOfDayUTC(toParam) : today;
  const dateTo = new Date(toRaw);
  dateTo.setUTCDate(dateTo.getUTCDate() + 1);

  const records = await db.checkInRecord.findMany({
    where: { checkedInAt: { gte: dateFrom, lt: dateTo } },
    orderBy: { checkedInAt: "asc" },
    include: {
      checkInSession: {
        select: {
          id: true,
          programId: true,
          eventId: true,
        },
      },
    },
  });

  // Bulk-load lookup names for performance.
  const childIds = Array.from(new Set(records.map((r) => r.childPersonId)));
  const familyIds = Array.from(new Set(records.map((r) => r.familyId)));
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
  const eventIds = Array.from(
    new Set(
      records
        .map((r) => r.checkInSession.eventId)
        .filter((x): x is string => !!x),
    ),
  );

  const [children, families, classes, rooms, programs, events] = await Promise.all([
    childIds.length
      ? db.person.findMany({
          where: { id: { in: childIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    familyIds.length
      ? db.family.findMany({
          where: { id: { in: familyIds } },
          select: { id: true, familyName: true },
        })
      : Promise.resolve([]),
    classIds.length
      ? db.groupClass.findMany({
          where: { id: { in: classIds } },
          select: { id: true, name: true },
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
    eventIds.length
      ? db.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const childById = new Map(children.map((c) => [c.id, c]));
  const familyById = new Map(families.map((f) => [f.id, f]));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const programById = new Map(programs.map((p) => [p.id, p]));
  const eventById = new Map(events.map((e) => [e.id, e]));

  const header = [
    "childName",
    "familyName",
    "programName",
    "eventName",
    "className",
    "roomName",
    "checkedInAt",
    "checkedOutAt",
    "durationMinutes",
    "method",
    "checkoutMethod",
    "dailyCode",
  ];

  const csvRows: CsvValue[][] = records.map((r) => {
    const child = childById.get(r.childPersonId);
    const fam = familyById.get(r.familyId);
    const cls = r.classId ? classById.get(r.classId) : null;
    const room = r.roomId ? roomById.get(r.roomId) : null;
    const prog = r.checkInSession.programId ? programById.get(r.checkInSession.programId) : null;
    const evt = r.checkInSession.eventId ? eventById.get(r.checkInSession.eventId) : null;
    const durationMinutes =
      r.checkedOutAt != null
        ? Math.max(0, Math.round((r.checkedOutAt.getTime() - r.checkedInAt.getTime()) / 60000))
        : "";
    return [
      child ? `${child.firstName} ${child.lastName}` : "",
      fam?.familyName ?? "",
      prog?.name ?? "",
      evt?.name ?? "",
      cls?.name ?? "",
      room?.name ?? "",
      r.checkedInAt.toISOString(),
      r.checkedOutAt ? r.checkedOutAt.toISOString() : "",
      durationMinutes,
      r.method,
      r.checkoutMethod ?? "",
      r.dailyCode,
    ];
  });

  const csv = buildCsv(header, csvRows);

  await logAudit({
    actorUserId,
    action: "export.attendance",
    entity: "CheckInRecord",
    details: {
      count: records.length,
      dateFrom: isoDay(dateFrom),
      dateTo: isoDay(toRaw),
      format: "csv",
    },
  });

  return new NextResponse(csv, {
    status: 200,
    headers: csvResponseHeaders(
      `attendance-${isoDay(dateFrom)}-to-${isoDay(toRaw)}.csv`,
    ),
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function exportAuditCsv(req: Request, actorUserId: string) {
  const url = new URL(req.url);
  const fromParam = parseDateParam(url.searchParams.get("dateFrom"));
  const toParam = parseDateParam(url.searchParams.get("dateTo"));

  const today = startOfDayUTC(new Date());
  const dateFrom = fromParam ? startOfDayUTC(fromParam) : (() => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - 29);
    return d;
  })();
  const toRaw = toParam ? startOfDayUTC(toParam) : today;
  const dateTo = new Date(toRaw);
  dateTo.setUTCDate(dateTo.getUTCDate() + 1);

  const logs = await db.auditLog.findMany({
    where: { createdAt: { gte: dateFrom, lt: dateTo } },
    orderBy: { createdAt: "asc" },
  });

  const header = [
    "id",
    "createdAt",
    "action",
    "actorUserId",
    "entity",
    "entityId",
    "details",
    "ip",
  ];

  const csvRows: CsvValue[][] = logs.map((l) => [
    l.id,
    l.createdAt.toISOString(),
    l.action,
    l.actorUserId ?? "",
    l.entity ?? "",
    l.entityId ?? "",
    l.details ?? "",
    l.ip ?? "",
  ]);

  const csv = buildCsv(header, csvRows);

  await logAudit({
    actorUserId,
    action: "export.audit",
    entity: "AuditLog",
    details: {
      count: logs.length,
      dateFrom: isoDay(dateFrom),
      dateTo: isoDay(toRaw),
      format: "csv",
    },
  });

  return new NextResponse(csv, {
    status: 200,
    headers: csvResponseHeaders(
      `audit-${isoDay(dateFrom)}-to-${isoDay(toRaw)}.csv`,
    ),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayTag(): string {
  return new Date().toISOString().slice(0, 10);
}
