import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { startOfDayUTC } from "@/lib/daily-code";

export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/visitor
 *
 * Quick-add a visitor family + children and check them in in one shot.
 *
 * Body:
 *   {
 *     firstName: string,  lastName: string,  phone: string,
 *     children: [{ firstName, lastName, dateOfBirth (ISO), allergies?, medicalNotes? }],
 *     programId: string | null,
 *     eventId: string | null,
 *     addToDatabase: boolean   // honours `visitors_add_to_db` flag
 *   }
 *
 * Behaviour:
 *   - If `addToDatabase` is true AND `visitors_add_to_db` flag is ON:
 *     create a real Person + Family (Person.isVisitor=true but intended to be
 *     kept — same as a regular family the admin would create).
 *   - Otherwise (addToDatabase false OR flag OFF): create a temporary Person
 *     with isVisitor=true + Family with notes "Visitor - do not add to
 *     regular DB". These can be purged later via admin tooling (Stage 12).
 *   - In both cases: create the family + members, run the check-in (create
 *     CheckInSession for the program/event if not exists, get-or-create the
 *     DailyCode, write CheckInRecords).
 *
 * Auth: same gate as the kiosk itself — open-mode kiosks can call anonymously.
 * If `kiosk_requires_login` is ON, require a Kiosk/Admin/Security session.
 *
 * Returns:
 *   { ok: true, familyId, dailyCode, checkedIn: [...], visitorKept: boolean }
 */

const childSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().datetime().optional().nullable(),
  allergies: z.string().max(2000).optional().nullable(),
  medicalNotes: z.string().max(4000).optional().nullable(),
});

const bodySchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(60).optional().nullable(),
  children: z.array(childSchema).min(1),
  programId: z.string().min(1).nullable(),
  eventId: z.string().min(1).nullable(),
  addToDatabase: z.boolean().default(false),
});

type CheckInResult = {
  childPersonId: string;
  checkInRecordId: string;
  childName: string;
  classId: string | null;
  className: string | null;
  roomName: string | null;
};

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
  const b = parsed.data;

  // Exactly one of programId / eventId must be set.
  if ((b.programId && b.eventId) || (!b.programId && !b.eventId)) {
    return NextResponse.json(
      { error: "validation", message: "Exactly one of programId/eventId must be set" },
      { status: 400 },
    );
  }

  const flags = await getFeatureFlags();
  const requiresLogin = flags.kiosk_requires_login === true;
  let actorUserId: string | null = null;
  if (requiresLogin) {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const ok =
      hasPermission(user.roles, "kiosk_operate") ||
      user.roles.includes("Admin") ||
      user.roles.includes("Security");
    if (!ok) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    actorUserId = user.id;
  } else {
    // Open mode: opportunistically attribute to an existing session.
    const user = await getCurrentUser();
    actorUserId = user?.id ?? null;
  }

  // `visitorKept` is true only when the admin-flag allows AND the visitor
  // opted in.
  const visitorKept = b.addToDatabase && flags.visitors_add_to_db === true;

  // -----------------------------------------------------------------------
  // Validate program/event + classes (if program, we'll auto-assign children
  // to the first class — visitor flow is intentionally simple).
  // -----------------------------------------------------------------------
  let program: { id: string; name: string } | null = null;
  let eventObj: { id: string; name: string } | null = null;
  if (b.programId) {
    program = await db.program.findUnique({
      where: { id: b.programId, isActive: true },
      select: { id: true, name: true },
    });
    if (!program) {
      return NextResponse.json({ error: "not_found", message: "Program not found" }, { status: 404 });
    }
  } else if (b.eventId) {
    eventObj = await db.event.findUnique({
      where: { id: b.eventId, isActive: true },
      select: { id: true, name: true },
    });
    if (!eventObj) {
      return NextResponse.json({ error: "not_found", message: "Event not found" }, { status: 404 });
    }
  }

  // Pre-fetch program classes (we'll auto-pick the first active one for each
  // child to mirror the regular check-in flow which always has a class for
  // program sessions). Visitor flow can let the guardian pick if needed but
  // defaulting keeps the flow short.
  let defaultClass: {
    id: string;
    name: string;
    roomId: string | null;
    room: { name: string | null } | null;
  } | null = null;
  if (program) {
    defaultClass = await db.groupClass.findFirst({
      where: { programId: program.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        roomId: true,
        room: { select: { name: true } },
      },
    });
  }

  const today = new Date();
  const sessionDate = startOfDayUTC(today);

  // -----------------------------------------------------------------------
  // Create the visitor family + persons + check-in records (transaction).
  // -----------------------------------------------------------------------
  const result = await db.$transaction(async (tx) => {
    // 1. Family.
    const familyNotes = visitorKept
      ? "Visitor family (added via kiosk quick-add)"
      : "Visitor - do not add to regular DB";
    const family = await tx.family.create({
      data: {
        familyName: b.lastName,
        notes: familyNotes,
        isActive: true,
        createdById: actorUserId,
      },
      select: { id: true, familyName: true },
    });

    // 2. Adult guardian Person + FamilyMember (PrimaryCarer).
    const adult = await tx.person.create({
      data: {
        firstName: b.firstName,
        lastName: b.lastName,
        personType: "Adult",
        phone: b.phone ?? null,
        isVisitor: true,
        isActive: true,
        createdById: actorUserId,
      },
      select: { id: true, firstName: true, lastName: true },
    });
    await tx.familyMember.create({
      data: {
        familyId: family.id,
        personId: adult.id,
        role: "PrimaryCarer",
      },
    });

    // 3. Child Persons + FamilyMember (Child) + CheckInRecords.
    const checkedIn: CheckInResult[] = [];

    // Get-or-create the CheckInSession for (program|event, today).
    const session = b.programId
      ? await tx.checkInSession.upsert({
          where: { programId_sessionDate: { programId: b.programId, sessionDate } },
          create: { programId: b.programId, eventId: null, sessionDate },
          update: {},
          select: { id: true },
        })
      : await tx.checkInSession.upsert({
          where: { eventId_sessionDate: { eventId: b.eventId!, sessionDate } },
          create: { programId: null, eventId: b.eventId!, sessionDate },
          update: {},
          select: { id: true },
        });

    const dailyCode = (
      await tx.dailyCode.upsert({
        where: { familyId_codeDate: { familyId: family.id, codeDate: sessionDate } },
        create: {
          familyId: family.id,
          codeDate: sessionDate,
          code: String(Math.floor(Math.random() * 1000)).padStart(3, "0"),
        },
        update: {},
        select: { code: true },
      })
    ).code;

    for (const c of b.children) {
      const child = await tx.person.create({
        data: {
          firstName: c.firstName,
          lastName: c.lastName,
          personType: "Child",
          dateOfBirth: c.dateOfBirth ? new Date(c.dateOfBirth) : null,
          allergies: c.allergies ?? null,
          medicalNotes: c.medicalNotes ?? null,
          isVisitor: true,
          isActive: true,
          createdById: actorUserId,
        },
        select: { id: true },
      });
      await tx.familyMember.create({
        data: {
          familyId: family.id,
          personId: child.id,
          role: "Child",
        },
      });
      const rec = await tx.checkInRecord.create({
        data: {
          checkInSessionId: session.id,
          childPersonId: child.id,
          familyId: family.id,
          classId: defaultClass?.id ?? null,
          roomId: defaultClass?.roomId ?? null,
          checkedInByPersonId: adult.id, // the visitor guardian is the carer
          checkedInByUserId: actorUserId,
          method: requiresLogin ? "kiosk_operator" : "kiosk_operator",
          dailyCode,
          labelPrinted: false,
        },
        select: { id: true },
      });
      checkedIn.push({
        childPersonId: child.id,
        checkInRecordId: rec.id,
        childName: `${c.firstName} ${c.lastName}`,
        classId: defaultClass?.id ?? null,
        className: defaultClass?.name ?? null,
        roomName: defaultClass?.room?.name ?? null,
      });
    }

    return { family, dailyCode, sessionId: session.id, checkedIn, adult };
  });

  await logAudit({
    actorUserId,
    action: "visitor.checkin",
    entity: "Family",
    entityId: result.family.id,
    details: {
      familyId: result.family.id,
      guardianPersonId: result.adult.id,
      guardianName: `${result.adult.firstName} ${result.adult.lastName}`,
      childCount: result.checkedIn.length,
      visitorKept,
      sessionDate: sessionDate.toISOString(),
      dailyCode: result.dailyCode,
      method: "kiosk_operator",
    },
  });

  return NextResponse.json({
    ok: true,
    familyId: result.family.id,
    dailyCode: result.dailyCode,
    sessionId: result.sessionId,
    checkedIn: result.checkedIn,
    visitorKept,
  });
}
