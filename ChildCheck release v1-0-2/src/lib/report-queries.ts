/**
 * Stage 10 — Shared report query logic.
 *
 * The API routes (`/api/admin/reports/*`) and the print view
 * (`/admin/reports/print`) both call these functions so the printed table is
 * always identical to the JSON / CSV output the dashboard sees.
 */

import { db } from "@/lib/db";
import { startOfDayUTC } from "@/lib/daily-code";
import { isoDay, parseDateParam } from "@/lib/reports-shared";

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export interface AttendanceRow {
  date: string;
  programId: string | null;
  programName: string | null;
  classId: string | null;
  className: string | null;
  checkedIn: number;
  checkedOut: number;
  stillIn: number;
}

export interface AttendanceReportResult {
  rows: AttendanceRow[];
  chart: { date: string; count: number }[];
  dateFrom: string;
  dateTo: string;
}

export interface AttendanceParams {
  programId?: string | null;
  classId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export async function attendanceReport(params: AttendanceParams): Promise<AttendanceReportResult> {
  const programId = params.programId?.trim() || null;
  const classId = params.classId?.trim() || null;

  const today = startOfDayUTC(new Date());
  const fromParam = parseDateParam(params.dateFrom ?? null);
  const dateFrom = fromParam ? startOfDayUTC(fromParam) : (() => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - 29);
    return d;
  })();
  const toParam = parseDateParam(params.dateTo ?? null);
  const dateToRaw = toParam ? startOfDayUTC(toParam) : today;
  const dateTo = new Date(dateToRaw);
  dateTo.setUTCDate(dateTo.getUTCDate() + 1);

  const where: Record<string, unknown> = {
    checkedInAt: { gte: dateFrom, lt: dateTo },
  };
  if (classId) where.classId = classId;
  if (programId) where.checkInSession = { programId };

  const records = await db.checkInRecord.findMany({
    where,
    include: { checkInSession: { select: { id: true, programId: true } } },
    orderBy: { checkedInAt: "asc" },
  });

  const classIds = Array.from(
    new Set(records.map((r) => r.classId).filter((x): x is string => !!x)),
  );
  const programIds = Array.from(
    new Set(
      records
        .map((r) => r.checkInSession.programId)
        .filter((x): x is string => !!x),
    ),
  );
  if (programId) programIds.push(programId);
  if (classId) classIds.push(classId);

  const [classes, programs] = await Promise.all([
    classIds.length
      ? db.groupClass.findMany({
          where: { id: { in: classIds } },
          select: { id: true, name: true, programId: true },
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
  const programById = new Map(programs.map((p) => [p.id, p]));

  interface Group {
    date: string;
    programId: string | null;
    classId: string | null;
    checkedIn: number;
    checkedOut: number;
    stillIn: number;
  }
  const groups = new Map<string, Group>();
  for (const r of records) {
    const day = isoDay(startOfDayUTC(r.checkedInAt));
    const pid = r.checkInSession.programId ?? null;
    const cid = r.classId ?? null;
    const key = `${day}|${pid ?? ""}|${cid ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { date: day, programId: pid, classId: cid, checkedIn: 0, checkedOut: 0, stillIn: 0 };
      groups.set(key, g);
    }
    g.checkedIn += 1;
    if (r.checkedOutAt != null) g.checkedOut += 1;
    else g.stillIn += 1;
  }

  const rows = Array.from(groups.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const aProg = a.programId ? programById.get(a.programId)?.name ?? "" : "";
    const bProg = b.programId ? programById.get(b.programId)?.name ?? "" : "";
    if (aProg !== bProg) return aProg < bProg ? -1 : 1;
    const aCls = a.classId ? classById.get(a.classId)?.name ?? "" : "";
    const bCls = b.classId ? classById.get(b.classId)?.name ?? "" : "";
    return aCls < bCls ? -1 : aCls > bCls ? 1 : 0;
  });

  const outRows: AttendanceRow[] = rows.map((g) => ({
    date: g.date,
    programId: g.programId,
    programName: g.programId ? programById.get(g.programId)?.name ?? null : null,
    classId: g.classId,
    className: g.classId ? classById.get(g.classId)?.name ?? null : null,
    checkedIn: g.checkedIn,
    checkedOut: g.checkedOut,
    stillIn: g.stillIn,
  }));

  const dayCount = new Map<string, number>();
  for (const r of records) {
    const day = isoDay(startOfDayUTC(r.checkedInAt));
    dayCount.set(day, (dayCount.get(day) ?? 0) + 1);
  }
  const chart: { date: string; count: number }[] = [];
  const cursor = new Date(dateFrom);
  while (cursor < dateTo) {
    const day = isoDay(cursor);
    chart.push({ date: day, count: dayCount.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { rows: outRows, chart, dateFrom: isoDay(dateFrom), dateTo: isoDay(dateToRaw) };
}

// ---------------------------------------------------------------------------
// Headcount trends
// ---------------------------------------------------------------------------

export interface HeadcountRow {
  date: string;
  reported: number | null;
  system: number;
  discrepancy: number | null;
}

export interface HeadcountReportResult {
  rows: HeadcountRow[];
  chart: { date: string; reported: number | null; system: number }[];
  dateFrom: string;
  dateTo: string;
}

export interface HeadcountParams {
  roomId?: string | null;
  classId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export async function headcountTrendsReport(params: HeadcountParams): Promise<HeadcountReportResult> {
  const roomId = params.roomId?.trim() || null;
  const classId = params.classId?.trim() || null;

  const today = startOfDayUTC(new Date());
  const fromParam = parseDateParam(params.dateFrom ?? null);
  const dateFrom = fromParam ? startOfDayUTC(fromParam) : (() => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - 29);
    return d;
  })();
  const toParam = parseDateParam(params.dateTo ?? null);
  const dateToRaw = toParam ? startOfDayUTC(toParam) : today;
  const dateTo = new Date(dateToRaw);
  dateTo.setUTCDate(dateTo.getUTCDate() + 1);

  const whereLog: Record<string, unknown> = {
    createdAt: { gte: dateFrom, lt: dateTo },
  };
  if (classId) whereLog.classId = classId;
  if (roomId) whereLog.roomId = roomId;
  const logs = await db.headcountLog.findMany({
    where: whereLog,
    orderBy: { createdAt: "asc" },
  });

  const reportedByDay = new Map<string, number>();
  for (const l of logs) {
    const day = isoDay(startOfDayUTC(l.createdAt));
    reportedByDay.set(day, l.count);
  }

  const whereRec: Record<string, unknown> = {
    checkedInAt: { gte: dateFrom, lt: dateTo },
  };
  if (classId) whereRec.classId = classId;
  if (roomId) whereRec.roomId = roomId;
  const records = await db.checkInRecord.findMany({
    where: whereRec,
    select: { checkedInAt: true, checkedOutAt: true },
    orderBy: { checkedInAt: "asc" },
  });

  const systemByDay = new Map<string, number>();
  const cursorA = new Date(dateFrom);
  while (cursorA < dateTo) {
    const dayStart = new Date(cursorA);
    const dayEnd = new Date(cursorA);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    let count = 0;
    for (const r of records) {
      const ci = r.checkedInAt;
      const co = r.checkedOutAt;
      if (ci < dayEnd && (co == null || co >= dayStart)) count += 1;
    }
    systemByDay.set(isoDay(cursorA), count);
    cursorA.setUTCDate(cursorA.getUTCDate() + 1);
  }

  const rows: HeadcountRow[] = [];
  const chart: { date: string; reported: number | null; system: number }[] = [];
  const cursor2 = new Date(dateFrom);
  while (cursor2 < dateTo) {
    const day = isoDay(cursor2);
    const reported = reportedByDay.has(day) ? (reportedByDay.get(day) ?? 0) : null;
    const system = systemByDay.get(day) ?? 0;
    const discrepancy = reported != null ? reported - system : null;
    rows.push({ date: day, reported, system, discrepancy });
    chart.push({ date: day, reported, system });
    cursor2.setUTCDate(cursor2.getUTCDate() + 1);
  }

  return { rows, chart, dateFrom: isoDay(dateFrom), dateTo: isoDay(dateToRaw) };
}

// ---------------------------------------------------------------------------
// Volunteer hours
// ---------------------------------------------------------------------------

export interface VolunteerHoursRow {
  userId: string;
  name: string;
  role: string;
  sessions: number;
  totalMinutes: number;
}

export interface VolunteerHoursResult {
  rows: VolunteerHoursRow[];
  dateFrom: string;
  dateTo: string;
}

export interface VolunteerHoursParams {
  dateFrom?: string | null;
  dateTo?: string | null;
}

export async function volunteerHoursReport(params: VolunteerHoursParams): Promise<VolunteerHoursResult> {
  const today = startOfDayUTC(new Date());
  const fromParam = parseDateParam(params.dateFrom ?? null);
  const dateFrom = fromParam ? startOfDayUTC(fromParam) : (() => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - 29);
    return d;
  })();
  const toParam = parseDateParam(params.dateTo ?? null);
  const dateToRaw = toParam ? startOfDayUTC(toParam) : today;
  const dateTo = new Date(dateToRaw);
  dateTo.setUTCDate(dateTo.getUTCDate() + 1);

  const userRoles = await db.userRole.findMany({
    where: { role: { in: ["Volunteer", "Teacher"] } },
    select: { userId: true, role: true },
  });
  const userIds = Array.from(new Set(userRoles.map((u) => u.userId)));
  const roleByUser = new Map<string, string[]>();
  for (const ur of userRoles) {
    const arr = roleByUser.get(ur.userId) ?? [];
    if (!arr.includes(ur.role)) arr.push(ur.role);
    roleByUser.set(ur.userId, arr);
  }

  if (userIds.length === 0) {
    return { rows: [], dateFrom: isoDay(dateFrom), dateTo: isoDay(dateToRaw) };
  }

  const records = await db.checkInRecord.findMany({
    where: {
      checkedInAt: { gte: dateFrom, lt: dateTo },
      OR: [
        { checkedInByUserId: { in: userIds } },
        { checkedOutByUserId: { in: userIds } },
      ],
    },
    select: {
      checkedInByUserId: true,
      checkedOutByUserId: true,
      checkedInAt: true,
      checkedOutAt: true,
    },
  });

  interface UserAgg { userId: string; sessions: number; totalMinutes: number }
  const agg = new Map<string, UserAgg>();
  for (const id of userIds) agg.set(id, { userId: id, sessions: 0, totalMinutes: 0 });

  for (const r of records) {
    const inUser = r.checkedInByUserId;
    const outUser = r.checkedOutByUserId;
    const minutes = r.checkedOutAt != null
      ? Math.max(0, Math.round((r.checkedOutAt.getTime() - r.checkedInAt.getTime()) / 60000))
      : 0;
    if (inUser && agg.has(inUser)) {
      const a = agg.get(inUser)!;
      a.sessions += 1;
      a.totalMinutes += minutes;
    }
    if (outUser && outUser !== inUser && agg.has(outUser)) {
      const a = agg.get(outUser)!;
      a.sessions += 1;
      a.totalMinutes += minutes;
    }
  }

  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    include: { person: { select: { firstName: true, lastName: true } } },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const rows: VolunteerHoursRow[] = userIds
    .map((id) => {
      const a = agg.get(id);
      const u = userById.get(id);
      if (!a || !u || !u.person) return null;
      const roles = roleByUser.get(id) ?? [];
      return {
        userId: id,
        name: `${u.person.firstName} ${u.person.lastName}`,
        role: roles.join(","),
        sessions: a.sessions,
        totalMinutes: a.totalMinutes,
      };
    })
    .filter((x): x is VolunteerHoursRow => x !== null)
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  return { rows, dateFrom: isoDay(dateFrom), dateTo: isoDay(dateToRaw) };
}

// ---------------------------------------------------------------------------
// Visitors
// ---------------------------------------------------------------------------

export interface VisitorRow {
  personId: string;
  name: string;
  firstVisitDate: string | null;
  visitCount: number;
  returned: boolean;
}

export interface VisitorReportResult {
  rows: VisitorRow[];
  dateFrom: string;
  dateTo: string;
}

export interface VisitorParams {
  dateFrom?: string | null;
  dateTo?: string | null;
}

export async function visitorsReport(params: VisitorParams): Promise<VisitorReportResult> {
  const today = startOfDayUTC(new Date());
  const fromParam = parseDateParam(params.dateFrom ?? null);
  const dateFrom = fromParam ? startOfDayUTC(fromParam) : (() => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - 89);
    return d;
  })();
  const toParam = parseDateParam(params.dateTo ?? null);
  const dateToRaw = toParam ? startOfDayUTC(toParam) : today;
  const dateTo = new Date(dateToRaw);
  dateTo.setUTCDate(dateTo.getUTCDate() + 1);

  const visitors = await db.person.findMany({
    where: { isVisitor: true },
    select: { id: true, firstName: true, lastName: true, createdAt: true },
  });
  const visitorIds = visitors.map((v) => v.id);
  if (visitorIds.length === 0) {
    return { rows: [], dateFrom: isoDay(dateFrom), dateTo: isoDay(dateToRaw) };
  }

  const allRecords = await db.checkInRecord.findMany({
    where: { childPersonId: { in: visitorIds } },
    select: { childPersonId: true, checkedInAt: true },
    orderBy: { checkedInAt: "asc" },
  });

  interface VisitorAgg { firstVisitDate: string | null; totalVisits: number; inRangeVisits: number }
  const agg = new Map<string, VisitorAgg>();
  for (const id of visitorIds) {
    agg.set(id, { firstVisitDate: null, totalVisits: 0, inRangeVisits: 0 });
  }
  for (const r of allRecords) {
    const a = agg.get(r.childPersonId);
    if (!a) continue;
    a.totalVisits += 1;
    if (r.checkedInAt >= dateFrom && r.checkedInAt < dateTo) {
      a.inRangeVisits += 1;
      const day = isoDay(startOfDayUTC(r.checkedInAt));
      if (!a.firstVisitDate || r.checkedInAt < new Date(a.firstVisitDate)) {
        a.firstVisitDate = day;
      }
    }
  }

  const rows: VisitorRow[] = visitors
    .map((v) => {
      const a = agg.get(v.id)!;
      return {
        personId: v.id,
        name: `${v.firstName} ${v.lastName}`,
        firstVisitDate: a.firstVisitDate,
        visitCount: a.inRangeVisits,
        returned: a.totalVisits >= 2,
      };
    })
    .sort((a, b) => {
      if (!a.firstVisitDate && !b.firstVisitDate) return a.name < b.name ? -1 : 1;
      if (!a.firstVisitDate) return 1;
      if (!b.firstVisitDate) return -1;
      return a.firstVisitDate < b.firstVisitDate ? 1 : -1;
    });

  return { rows, dateFrom: isoDay(dateFrom), dateTo: isoDay(dateToRaw) };
}

// ---------------------------------------------------------------------------
// WWCC expiry
// ---------------------------------------------------------------------------

export type WwccFlag = "expired" | "30" | "60" | "90" | "ok";

export interface WwccRow {
  personId: string;
  name: string;
  cardType: string;
  status: string;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  flag: WwccFlag;
}

export interface WwccReportResult {
  rows: WwccRow[];
}

export interface WwccParams {
  withinDays?: number;
}

export async function wwccExpiryReport(params: WwccParams): Promise<WwccReportResult> {
  const withinDays = typeof params.withinDays === "number" && Number.isFinite(params.withinDays)
    ? params.withinDays
    : 90;

  const cards = await db.workingWithChildrenCard.findMany({
    where: {},
    include: { person: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { expiresAt: "asc" },
  });

  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const rows: WwccRow[] = cards
    .map((c) => {
      const expiresAt = c.expiresAt;
      const daysUntilExpiry = expiresAt
        ? Math.floor((expiresAt.getTime() - now.getTime()) / oneDayMs)
        : null;
      let flag: WwccFlag;
      if (c.status === "Expired" || (daysUntilExpiry != null && daysUntilExpiry < 0)) {
        flag = "expired";
      } else if (daysUntilExpiry != null && daysUntilExpiry <= 30) {
        flag = "30";
      } else if (daysUntilExpiry != null && daysUntilExpiry <= 60) {
        flag = "60";
      } else if (daysUntilExpiry != null && daysUntilExpiry <= 90) {
        flag = "90";
      } else {
        flag = "ok";
      }
      return {
        personId: c.person.id,
        name: `${c.person.firstName} ${c.person.lastName}`,
        cardType: c.cardType,
        status: c.status,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        daysUntilExpiry,
        flag,
      };
    })
    .sort((a, b) => {
      const av = a.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
      const bv = b.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
      if (a.flag === "expired" && b.flag !== "expired") return -1;
      if (b.flag === "expired" && a.flag !== "expired") return 1;
      if (av !== bv) return av < bv ? -1 : 1;
      return a.name < b.name ? -1 : 1;
    });

  const filtered = withinDays > 0
    ? rows.filter((r) => {
        if (r.flag === "expired") return true;
        if (r.daysUntilExpiry == null) return true;
        return r.daysUntilExpiry <= withinDays;
      })
    : rows;

  return { rows: filtered };
}
