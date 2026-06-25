import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getDailyCode, startOfDayUTC } from "@/lib/daily-code";
import {
  dispatchSlip,
  fallbackBrowserPrinter,
  formatPrintDate,
  resolvePrinter,
  type PrintResult,
  type SlipChildRow,
  type SlipData,
} from "@/lib/printing";

export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/print/slip
 *
 * Stage 11 — Renders the signout-code slip (daily code big, family name,
 * children + classes, date) and dispatches it to the resolved slip printer.
 * Returns one of:
 *   - { ok, method: "browser", html, printerName, kind: "slip" }
 *   - { ok, method: "qz_tray", payload, printerName, kind: "slip" }
 *   - { ok, method: "thermal_raw", commands, printerName, kind: "slip" }
 *
 * Body: { familyId: string, date?: string (ISO) }
 *
 * Resolution: the printer is selected by looking up the most-recent check-in
 * for this family today (so we know which room to resolve the printer from).
 * If no room is reachable, the default slip printer is used (or browser
 * fallback).
 */
const bodySchema = z.object({
  familyId: z.string().min(1),
  date: z.string().datetime().optional(),
});

export async function POST(req: Request) {
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
  const { familyId, date } = parsed.data;
  const day = date ? new Date(date) : new Date();
  const sessionDate = startOfDayUTC(day);

  const family = await db.family.findUnique({
    where: { id: familyId },
    select: { id: true, familyName: true },
  });
  if (!family) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Daily code may not exist yet if no check-in happened (shouldn't happen
  // here since the slip is shown after a successful check-in, but be safe).
  const dailyCode = (await getDailyCode(familyId, day)) ?? "—";

  // Look up today's check-ins for this family — we render the children list
  // from those, and use the most-recent record's room to resolve the printer.
  // CheckInRecord stores childPersonId/classId/roomId as plain strings (no
  // relations defined on the model itself), so we resolve them after.
  const dayEnd = new Date(sessionDate);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const records = await db.checkInRecord.findMany({
    where: {
      familyId,
      checkedInAt: { gte: sessionDate, lt: dayEnd },
    },
    orderBy: { checkedInAt: "asc" },
    select: {
      id: true,
      childPersonId: true,
      classId: true,
      roomId: true,
      checkedInAt: true,
    },
  });

  // Resolve each child/class/room in parallel.
  const childIds = Array.from(new Set(records.map((r) => r.childPersonId)));
  const classIds = Array.from(new Set(records.map((r) => r.classId).filter((x): x is string => Boolean(x))));
  const roomIds = Array.from(new Set(records.map((r) => r.roomId).filter((x): x is string => Boolean(x))));

  const [childRows, classRows, roomRows] = await Promise.all([
    db.person.findMany({
      where: { id: { in: childIds } },
      select: { id: true, firstName: true, lastName: true, preferredName: true },
    }),
    classIds.length > 0
      ? db.groupClass.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    roomIds.length > 0
      ? db.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const childMap = new Map(childRows.map((c) => [c.id, c]));
  const classMap = new Map(classRows.map((c) => [c.id, c]));
  const roomMap = new Map(roomRows.map((r) => [r.id, r]));

  const children: SlipChildRow[] = records.map((r) => {
    const c = childMap.get(r.childPersonId);
    const cls = r.classId ? classMap.get(r.classId) : undefined;
    const rm = r.roomId ? roomMap.get(r.roomId) : undefined;
    return {
      name: c
        ? [c.preferredName || c.firstName, c.lastName].filter(Boolean).join(" ")
        : "Unknown",
      className: cls?.name ?? null,
      roomName: rm?.name ?? null,
    };
  });

  // Resolve the printer — use the most-recent record's room.
  const latestRoomId = records.length > 0 ? records[records.length - 1].roomId : null;
  const resolved = (await resolvePrinter(latestRoomId, "slip")) ?? fallbackBrowserPrinter();

  const slipData: SlipData = {
    familyName: family.familyName,
    dailyCode,
    date: formatPrintDate(day),
    children: children.length > 0 ? children : [{ name: "(no check-ins today)", className: null, roomName: null }],
  };

  const result: PrintResult = dispatchSlip(resolved, slipData);

  const user = await getCurrentUser();
  await logAudit({
    actorUserId: user?.id ?? null,
    action: "print.slip",
    entity: "Family",
    entityId: family.id,
    details: {
      familyId: family.id,
      sessionDate: sessionDate.toISOString(),
      dailyCode,
      printerId: resolved.id,
      printerName: resolved.name,
      driver: resolved.driver,
      childCount: children.length,
    },
  });

  return NextResponse.json(result);
}
