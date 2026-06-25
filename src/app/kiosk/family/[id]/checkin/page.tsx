import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags";
import { getOrgConfig } from "@/lib/branding";
import { getActiveProgramsForDate, type ActiveProgramForDate } from "@/lib/sessions";
import { dayLong, dayNumberOfWeek } from "@/lib/week";
import { startOfDayUTC } from "@/lib/daily-code";
import {
  CheckInFlow,
  type CheckInFlowProps,
} from "./checkin-flow";

export const dynamic = "force-dynamic";

/**
 * /kiosk/family/[id]/checkin — Stage 7 multi-child check-in flow.
 *
 * Server component shell — loads the family + members (WITH medical fields,
 * because this page surfaces allergy/medical alerts at check-in selection
 * — the safety-critical surfacing that the search list deliberately omits),
 * today's active programs, and the family's currently-open check-in records
 * for today (so we can render "Already checked in ✓" on each child row).
 *
 * Same access gate as the family detail page: in locked mode requires
 * Kiosk/Admin/Security; otherwise open.
 */
export default async function KioskCheckinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [config, flags] = await Promise.all([getOrgConfig(), getFeatureFlags()]);
  const requiresLogin = flags.kiosk_requires_login === true;

  if (requiresLogin) {
    const user = await getCurrentUser();
    const ok =
      !!user &&
      (user.roles.includes("Kiosk") ||
        user.roles.includes("Admin") ||
        user.roles.includes("Security"));
    if (!ok) {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            Kiosk is locked. Please return to the{" "}
            <a href="/kiosk" className="underline">kiosk home</a> to unlock.
          </p>
        </div>
      );
    }
  }

  const family = await db.family.findUnique({
    where: { id, isActive: true },
    include: {
      members: {
        include: {
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              personType: true,
              dateOfBirth: true,
              schoolGrade: true,
              allergies: true,
              medicalNotes: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!family) notFound();

  // Today's active programs.
  const today = new Date();
  const activePrograms: ActiveProgramForDate[] = await getActiveProgramsForDate(today);

  // Currently-open check-in records for this family today (for "Already
  // checked in ✓" badges).
  const dayStart = startOfDayUTC(today);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const openRecords = await db.checkInRecord.findMany({
    where: {
      familyId: family.id,
      checkedInAt: { gte: dayStart, lt: dayEnd },
      checkedOutAt: null,
    },
    include: {
      checkInSession: { select: { id: true, programId: true, eventId: true } },
    },
  });

  // Build child DTOs (WITH medical details — this is the check-in selection
  // screen, which is allowed to show them).
  const children = family.members
    .filter((m) => m.role === "Child")
    .map((m) => {
      const ageYears = m.person.dateOfBirth ? computeAge(m.person.dateOfBirth) : null;
      const openRecord = openRecords.find((r) => r.childPersonId === m.person.id);
      return {
        id: m.person.id,
        firstName: m.person.firstName,
        lastName: m.person.lastName,
        ageYears,
        schoolGrade: m.person.schoolGrade,
        allergies: m.person.allergies,
        medicalNotes: m.person.medicalNotes,
        currentlyCheckedIn: openRecord
          ? {
              sessionId: openRecord.checkInSession.id,
              programId: openRecord.checkInSession.programId,
              eventId: openRecord.checkInSession.eventId,
            }
          : null,
      };
    });

  // Adult guardians (carers + authorised guardians) — for guardian PIN flow.
  const adults = family.members
    .filter((m) => m.person.personType === "Adult" && (m.role === "PrimaryCarer" || m.role === "AuthorisedGuardian"))
    .map((m) => ({
      id: m.person.id,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
      role: m.role,
    }));

  const props: CheckInFlowProps = {
    familyId: family.id,
    familyName: family.familyName,
    todayLabel: `${dayLong(today.getDay())} (Day ${dayNumberOfWeek(today.getDay(), config.weekStartsOn)})`,
    children,
    adults,
    activePrograms: activePrograms.map((p) => ({
      programId: p.programId,
      programName: p.programName,
      slug: p.slug,
      firstScheduleTime: p.classes[0]?.scheduleStart ?? null,
      classes: p.classes.map((c) => ({
        classId: c.classId,
        className: c.className,
        roomName: c.roomName,
        scheduleStart: c.scheduleStart,
        scheduleEnd: c.scheduleEnd,
      })),
      events: p.events.map((e) => ({ eventId: e.eventId, eventName: e.eventName })),
    })),
    guardianPinSignin: flags.guardian_pin_signin === true,
    printNameLabels: flags.print_name_labels === true,
    printSignoutCode: flags.print_signout_code === true,
    requiresLogin,
  };

  return <CheckInFlow {...props} />;
}

function computeAge(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : 0;
}
