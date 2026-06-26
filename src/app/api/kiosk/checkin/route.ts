import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { startOfDayUTC, getOrCreateDailyCode } from "@/lib/daily-code";
import { broadcastRealtime, roomsForScope } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/checkin
 *
 * Performs a multi-child check-in for a family against a single
 * program-or-event session for today.
 *
 * Body:
 *   {
 *     familyId: string,
 *     programId: string | null,   // exactly one of programId / eventId set
 *     eventId:   string | null,
 *     children:  [{ childPersonId, classId? }],
 *     checkedInByPersonId: string | null,  // the adult (carer/guardian) — null for anonymous kiosk
 *     method: "guardian_pin" | "kiosk_operator" | "admin" | "teacher"
 *   }
 *
 * Access control:
 *   - method "guardian_pin": REQUIRES guardian_pin_signin flag ON. The caller
 *     passes `checkedInByPersonId` of an Adult Person in the family; this is
 *     trusted because the guardian verified their PIN via
 *     /api/kiosk/guardian-signin moments earlier. We re-verify the person is
 *     actually a PrimaryCarer / AuthorisedGuardian of the family to be safe.
 *   - method "kiosk_operator" | "admin" | "teacher": requires a NextAuth
 *     session with the appropriate role. If `kiosk_requires_login` is OFF, an
 *     anonymous kiosk walk-up is permitted (method "kiosk_operator", no user)
 *     — the kiosk is trusted in open mode. When ON, the kiosk operator MUST
 *     be authenticated.
 *
 * Validation:
 *   - Exactly one of programId/eventId set.
 *   - `children` non-empty; each childPersonId must be a Child member of the
 *     family. classId (if set for a program session) must belong to that program.
 *   - Idempotency: a child already checked-in-and-not-out for the SAME session
 *     is skipped, returned in `skipped[]`. Others are still processed.
 *
 * Returns:
 *   { ok: true, dailyCode, sessionId, checkedIn: [...], skipped: [...] }
 *
 * Daily code: generated regardless of method/flag — see src/lib/daily-code.ts.
 */

const methodEnum = z.enum([
  "guardian_pin",
  "kiosk_operator",
  "admin",
  "teacher",
]);

const childSchema = z.object({
  childPersonId: z.string().min(1),
  classId: z.string().min(1).nullable().optional(),
});

const bodySchema = z.object({
  familyId: z.string().min(1),
  programId: z.string().min(1).nullable(),
  eventId: z.string().min(1).nullable(),
  children: z.array(childSchema).min(1),
  checkedInByPersonId: z.string().min(1).nullable(),
  method: methodEnum,
});

type CheckInResult = {
  childPersonId: string;
  checkInRecordId: string;
  classId: string | null;
  className: string | null;
  roomName: string | null;
};
type SkippedResult = {
  childPersonId: string;
  reason: "already_checked_in";
};

export async function POST(req: Request) {
  // -----------------------------------------------------------------------
  // Parse + validate body.
  // -----------------------------------------------------------------------
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
  const { familyId, programId, eventId, children, checkedInByPersonId, method } =
    parsed.data;

  // Exactly one of programId / eventId must be set.
  if ((programId && eventId) || (!programId && !eventId)) {
    return NextResponse.json(
      { error: "validation", message: "Exactly one of programId/eventId must be set" },
      { status: 400 },
    );
  }

  const flags = await getFeatureFlags();
  const today = new Date();
  const sessionDate = startOfDayUTC(today);

  // -----------------------------------------------------------------------
  // Access control. Determine `actorUserId` (may be null for anonymous kiosk
  // in open mode or guardian_pin self-serve).
  // -----------------------------------------------------------------------
  let actorUserId: string | null = null;
  const user = await getCurrentUser();

  if (method === "guardian_pin") {
    if (!flags.guardian_pin_signin) {
      return NextResponse.json(
        { error: "pin_signin_disabled" },
        { status: 409 },
      );
    }
    // `checkedInByPersonId` MUST be supplied and must be a PrimaryCarer or
    // AuthorisedGuardian of the family. (The kiosk verified the PIN via
    // /api/kiosk/guardian-signin just before this call.)
    if (!checkedInByPersonId) {
      return NextResponse.json(
        { error: "validation", message: "checkedInByPersonId required for guardian_pin method" },
        { status: 400 },
      );
    }
    const membership = await db.familyMember.findFirst({
      where: {
        familyId,
        personId: checkedInByPersonId,
        role: { in: ["PrimaryCarer", "AuthorisedGuardian"] },
        person: { personType: "Adult", isActive: true },
      },
      select: { id: true, role: true },
    });
    if (!membership) {
      return NextResponse.json(
        { error: "forbidden", message: "checkedInByPersonId is not an authorised carer/guardian of this family" },
        { status: 403 },
      );
    }
    // No actorUserId for guardian self-serve — it's not a User account.
    actorUserId = null;
  } else {
    // kiosk_operator | admin | teacher
    const requiresLogin = flags.kiosk_requires_login === true;
    if (requiresLogin || method === "admin" || method === "teacher") {
      if (!user) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const ok =
        method === "admin"
          ? user.roles.includes("Admin")
          : method === "teacher"
            ? user.roles.includes("Teacher") || user.roles.includes("Admin")
            : // kiosk_operator
              hasPermission(user.roles, "kiosk_operate") ||
              user.roles.includes("Admin") ||
              user.roles.includes("Security");
      if (!ok) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      actorUserId = user.id;
    } else {
      // Open-mode kiosk walk-up: anonymous kiosk operator permitted.
      if (user) {
        actorUserId = user.id; // opportunistically attribute if a session exists
      }
    }
  }

  // -----------------------------------------------------------------------
  // Load the family + verify all children belong to it as Child members.
  // -----------------------------------------------------------------------
  const family = await db.family.findUnique({
    where: { id: familyId, isActive: true },
    select: { id: true, familyName: true },
  });
  if (!family) {
    return NextResponse.json({ error: "not_found", message: "Family not found" }, { status: 404 });
  }

  const requestedChildIds = children.map((c) => c.childPersonId);
  const memberships = await db.familyMember.findMany({
    where: {
      familyId,
      personId: { in: requestedChildIds },
      role: "Child",
      person: { personType: "Child", isActive: true },
    },
    include: {
      person: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          allergies: true,
          medicalNotes: true,
        },
      },
    },
  });
  const validChildIds = new Set(memberships.map((m) => m.person.id));
  for (const c of children) {
    if (!validChildIds.has(c.childPersonId)) {
      return NextResponse.json(
        { error: "validation", message: `child ${c.childPersonId} is not a Child member of family ${familyId}` },
        { status: 400 },
      );
    }
  }

  // -----------------------------------------------------------------------
  // If programId: validate classId belongs to that program. If eventId:
  // classId optional.
  // -----------------------------------------------------------------------
  let program: { id: string; name: string } | null = null;
  let eventObj: { id: string; name: string } | null = null;
  if (programId) {
    program = await db.program.findUnique({
      where: { id: programId, isActive: true },
      select: { id: true, name: true },
    });
    if (!program) {
      return NextResponse.json({ error: "not_found", message: "Program not found" }, { status: 404 });
    }
    // Validate each classId (if set) belongs to the program.
    const classIdsToCheck = children
      .map((c) => c.classId ?? null)
      .filter((x): x is string => !!x);
    if (classIdsToCheck.length > 0) {
      const validClasses = await db.groupClass.findMany({
        where: { id: { in: classIdsToCheck }, programId, isActive: true },
        select: { id: true, name: true, roomId: true, room: { select: { name: true } } },
      });
      const validClassIds = new Set(validClasses.map((c) => c.id));
      for (const c of children) {
        if (c.classId && !validClassIds.has(c.classId)) {
          return NextResponse.json(
            { error: "validation", message: `class ${c.classId} does not belong to program ${programId}` },
            { status: 400 },
          );
        }
      }
    }
  } else if (eventId) {
    eventObj = await db.event.findUnique({
      where: { id: eventId, isActive: true },
      select: { id: true, name: true },
    });
    if (!eventObj) {
      return NextResponse.json({ error: "not_found", message: "Event not found" }, { status: 404 });
    }
  }

  // -----------------------------------------------------------------------
  // All checks passed. Run the check-in inside a transaction:
  //   1. get-or-create the DailyCode for (familyId, today) — OUTSIDE the tx
  //      so SQLite's single-writer lock doesn't deadlock with the session
  //      upsert below.
  //   2. inside tx: get-or-create the CheckInSession for
  //      (programId|eventId, today)
  //   3. for each child: skip if already-checked-in-not-out for this session,
  //      else create a CheckInRecord.
  //   4. AuditLog (outside tx — best-effort).
  // -----------------------------------------------------------------------
  const checkedIn: CheckInResult[] = [];
  const skipped: SkippedResult[] = [];

  // For each child, resolve classId → room ahead of time (used to denormalise
  // roomId onto the record and to return className/roomName to the UI).
  const childClassMeta = new Map<
    string,
    {
      classId: string;
      className: string;
      roomName: string | null;
      roomId: string | null;
    } | null
  >();
  const classIdByChild = new Map<string, string | null>();
  for (const c of children) {
    classIdByChild.set(c.childPersonId, c.classId ?? null);
  }
  const allClassIds = Array.from(
    new Set(
      children
        .map((c) => c.classId ?? null)
        .filter((x): x is string => !!x),
    ),
  );
  const classRows = allClassIds.length
    ? await db.groupClass.findMany({
        where: { id: { in: allClassIds } },
        select: {
          id: true,
          name: true,
          roomId: true,
          room: { select: { name: true } },
        },
      })
    : [];
  const classMetaById = new Map(classRows.map((c) => [c.id, c]));

  for (const m of memberships) {
    const cid = m.person.id;
    const classId = classIdByChild.get(cid) ?? null;
    childClassMeta.set(
      cid,
      classId && classMetaById.has(classId)
        ? {
            classId,
            className: classMetaById.get(classId)!.name,
            roomId: classMetaById.get(classId)!.roomId,
            roomName: classMetaById.get(classId)!.room?.name ?? null,
          }
        : null,
    );
  }

  // 1. Get-or-create DailyCode OUTSIDE the transaction — it's a separate
  //    unique-keyed row that doesn't depend on the session, and running it
  //    inside the tx caused SQLite's single-writer lock to exceed the
  //    default 5s tx timeout.
  const dailyCode = await getOrCreateDailyCode(familyId, today);

  const result = await db.$transaction(async (tx) => {
    // 2. Get-or-create CheckInSession.
    // We use upsert against the appropriate @@unique index. Because exactly
    // one of programId/eventId is set, only one of the two unique indexes
    // applies per call — the other column being null lets SQLite's NULL
    // distinctness keep the two scopes separate.
    const session = programId
      ? await tx.checkInSession.upsert({
          where: { programId_sessionDate: { programId, sessionDate } },
          create: { programId, eventId: null, sessionDate },
          update: {},
          select: { id: true },
        })
      : await tx.checkInSession.upsert({
          // eventId is non-null here (validated above)
          where: { eventId_sessionDate: { eventId: eventId!, sessionDate } },
          create: { programId: null, eventId: eventId!, sessionDate },
          update: {},
          select: { id: true },
        });

    // 3. For each requested child, check for an existing open record in this
    //    session. If exists → skip. Else create.
    for (const m of memberships) {
      const cid = m.person.id;
      const existing = await tx.checkInRecord.findFirst({
        where: {
          checkInSessionId: session.id,
          childPersonId: cid,
          checkedOutAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        skipped.push({ childPersonId: cid, reason: "already_checked_in" });
        continue;
      }
      const meta = childClassMeta.get(cid) ?? null;
      const rec = await tx.checkInRecord.create({
        data: {
          checkInSessionId: session.id,
          childPersonId: cid,
          familyId,
          classId: meta?.classId ?? null,
          roomId: meta?.roomId ?? null,
          checkedInByPersonId: checkedInByPersonId ?? null,
          checkedInByUserId: actorUserId,
          method,
          dailyCode,
          labelPrinted: false,
        },
        select: { id: true },
      });
      checkedIn.push({
        childPersonId: cid,
        checkInRecordId: rec.id,
        classId: meta?.classId ?? null,
        className: meta?.className ?? null,
        roomName: meta?.roomName ?? null,
      });
    }

    return { sessionId: session.id };
  });

  // -----------------------------------------------------------------------
  // Audit. Best-effort — never break the response on audit failure.
  // -----------------------------------------------------------------------
  // Surfaced allergy / medical flag (boolean only — never contents).
  const hasAlertsChildIds = memberships
    .filter(
      (m) =>
        (m.person.allergies && m.person.allergies.trim().length > 0) ||
        (m.person.medicalNotes && m.person.medicalNotes.trim().length > 0),
    )
    .map((m) => m.person.id);
  await logAudit({
    actorUserId,
    action: "checkin",
    entity: program ? "Program" : "Event",
    entityId: programId ?? eventId ?? null,
    details: {
      familyId,
      sessionDate: sessionDate.toISOString(),
      sessionId: result.sessionId,
      childCount: checkedIn.length,
      skippedCount: skipped.length,
      method,
      dailyCode,
      checkedInByPersonId: checkedInByPersonId ?? null,
      hasAlertsOnCheckedIn: hasAlertsChildIds.length > 0,
      hasAlertsChildCount: hasAlertsChildIds.length,
    },
  });

  // -----------------------------------------------------------------------
  // Realtime broadcast — notify any volunteer dashboard subscribed to the
  // relevant room / class / program / session channel. Best-effort.
  // -----------------------------------------------------------------------
  if (checkedIn.length > 0) {
    // Collect all room/class/program ids touched by this check-in. We use the
    // childClassMeta map (resolved earlier) which has the roomId for each
    // checked-in child's class.
    const scopeRooms = new Set<string>();
    for (const c of checkedIn) {
      const meta = childClassMeta.get(c.childPersonId);
      for (const r of roomsForScope({
        roomId: meta?.roomId ?? null,
        classId: c.classId,
        programId,
        eventId: eventId ?? null,
        checkInSessionId: result.sessionId,
      })) {
        scopeRooms.add(r);
      }
    }
    if (programId) scopeRooms.add(`program:${programId}`);
    scopeRooms.add(`session:${result.sessionId}`);
    await broadcastRealtime({
      event: "checkin:update",
      rooms: Array.from(scopeRooms),
      payload: {
        sessionId: result.sessionId,
        programId,
        eventId,
        familyId,
        checkedInCount: checkedIn.length,
        childPersonIds: checkedIn.map((c) => c.childPersonId),
        method,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    dailyCode,
    sessionId: result.sessionId,
    checkedIn,
    skipped,
  });
}
