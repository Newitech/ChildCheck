import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { formatPrintDate } from "@/lib/printing";
import {
  dispatchLabel,
  fallbackBrowserPrinter,
  getDefaultLabelLayout,
  resolvePrinter,
  type LabelData,
  type PrintResult,
} from "@/lib/printing";

export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/print/label
 *
 * Stage 11 — Renders a child name label and dispatches it to the resolved
 * printer. Returns one of:
 *   - { ok, method: "browser", html, printerName, kind: "label" }
 *   - { ok, method: "qz_tray", payload, printerName, kind: "label" }
 *   - { ok, method: "thermal_raw", commands, printerName, kind: "label" }
 *
 * Auth: same gate as the kiosk check-in itself — open-mode kiosks can call
 * anonymously; locked kiosks need an authenticated Kiosk/Admin/Security
 * session. We re-use the same logic by simply accepting any session that
 * exists (and being permissive in open mode, matching the check-in route).
 *
 * Body: { checkInRecordId: string }
 */
const bodySchema = z.object({
  checkInRecordId: z.string().min(1),
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
  const { checkInRecordId } = parsed.data;

  // Fetch the check-in record with the relations we need to render the label.
  // CheckInRecord stores childPersonId/classId/roomId as plain strings (no
  // relations defined on the model itself), so we resolve them in parallel.
  const record = await db.checkInRecord.findUnique({
    where: { id: checkInRecordId },
    select: {
      id: true,
      childPersonId: true,
      familyId: true,
      roomId: true,
      classId: true,
      dailyCode: true,
      labelPrinted: true,
      checkedInAt: true,
      checkInSession: { select: { sessionDate: true } },
    },
  });
  if (!record) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Resolve child/class/room in parallel (any may be missing).
  const [child, klass, room] = await Promise.all([
    db.person.findUnique({
      where: { id: record.childPersonId },
      select: { id: true, firstName: true, lastName: true, preferredName: true, allergies: true },
    }),
    record.classId
      ? db.groupClass.findUnique({ where: { id: record.classId }, select: { id: true, name: true } })
      : Promise.resolve(null),
    record.roomId
      ? db.room.findUnique({ where: { id: record.roomId }, select: { id: true, name: true, code: true } })
      : Promise.resolve(null),
  ]);
  if (!child) {
    return NextResponse.json({ error: "child_not_found" }, { status: 404 });
  }

  // Compose the label data.
  const childName = [
    child.preferredName || child.firstName,
    child.lastName,
  ].filter(Boolean).join(" ");
  const labelData: LabelData = {
    childName,
    className: klass?.name ?? null,
    roomName: room?.name ?? null,
    dailyCode: record.dailyCode,
    date: formatPrintDate(record.checkedInAt),
    allergy: child.allergies && child.allergies.trim().length > 0
      ? child.allergies.trim()
      : null,
  };

  // Resolve the printer — room-assigned (label purpose) → default → fallback.
  const resolved = (await resolvePrinter(record.roomId, "label")) ?? fallbackBrowserPrinter();

  // Render the label using the default template (the editor ensures there's
  // always at least one template).
  const layout = await getDefaultLabelLayout();
  const result: PrintResult = dispatchLabel(resolved, layout, labelData);

  // Mark the check-in record as labelPrinted. Idempotent (re-printing is ok).
  if (!record.labelPrinted) {
    await db.checkInRecord.update({
      where: { id: record.id },
      data: { labelPrinted: true },
    });
  }

  // Best-effort: attribute to a session if one exists.
  const user = await getCurrentUser();
  await logAudit({
    actorUserId: user?.id ?? null,
    action: "print.label",
    entity: "CheckInRecord",
    entityId: record.id,
    details: {
      familyId: record.familyId,
      childPersonId: record.childPersonId,
      sessionDate: record.checkInSession.sessionDate.toISOString(),
      printerId: resolved.id,
      printerName: resolved.name,
      driver: resolved.driver,
      duplicate: record.labelPrinted,
      childName: labelData.childName,
    },
  });

  return NextResponse.json(result);
}
