import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags";
import { getOrgConfig } from "@/lib/branding";
import { getActiveProgramsForDate, type ActiveProgramForDate } from "@/lib/sessions";
import { dayLong, dayNumberOfWeek } from "@/lib/week";
import { startOfDayUTC } from "@/lib/daily-code";
import { FamilyDetail, type KioskFamilyDetailDTO } from "./family-detail";

export const dynamic = "force-dynamic";

/**
 * /kiosk/family/[id] — Family detail (Stage 6).
 *
 * Loads the family + members WITHOUT medical details (those are revealed
 * only at Stage 7 check-in selection). Computes hasAlerts per child as a
 * boolean so the kiosk can show a red badge without leaking what the alert
 * is. Same auth gate as /kiosk: in locked mode, requires Kiosk/Admin/Security.
 *
 * Photos: deliberately NOT loaded here. Stage 7 will wire a dedicated
 * kiosk-photo route that respects room/role scoping; for Stage 6 we render
 * initials avatars only.
 *
 * Stage 7 additions: includes each child's currently-open CheckInRecord for
 * today (if any), so the family detail can show a "Currently checked in ✓"
 * badge and the check-in CTA can pre-warn about already-checked-in children.
 */
export default async function KioskFamilyDetailPage({
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
      // Soft-deny: render a minimal "locked" prompt. The page itself is
      // public-by-default; we just refuse to render family data here.
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
              middleName: true,
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
      blacklistEntries: {
        select: { id: true },
      },
    },
  });
  if (!family) notFound();

  const today = new Date();
  const activePrograms: ActiveProgramForDate[] = await getActiveProgramsForDate(today);

  // Load today's open check-in records for this family so we can badge children.
  const dayStart = startOfDayUTC(today);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const openRecords = await db.checkInRecord.findMany({
    where: {
      familyId: family.id,
      checkedInAt: { gte: dayStart, lt: dayEnd },
      checkedOutAt: null,
    },
    select: {
      id: true,
      childPersonId: true,
      checkInSession: { select: { programId: true, eventId: true } },
    },
  });
  const openRecordByChild = new Map(openRecords.map((r) => [r.childPersonId, r]));

  const dto: KioskFamilyDetailDTO = {
    id: family.id,
    familyName: family.familyName,
    hasFamilyBlacklist: family.blacklistEntries.length > 0,
    primaryCarers: family.members
      .filter((m) => m.role === "PrimaryCarer" && m.person.personType === "Adult")
      .map((m) => ({
        id: m.person.id,
        firstName: m.person.firstName,
        middleName: m.person.middleName,
        lastName: m.person.lastName,
      })),
    children: family.members
      .filter((m) => m.role === "Child")
      .map((m) => {
        const hasAlerts = Boolean(
          (m.person.allergies && m.person.allergies.trim().length > 0) ||
          (m.person.medicalNotes && m.person.medicalNotes.trim().length > 0),
        );
        const ageYears = m.person.dateOfBirth ? computeAge(m.person.dateOfBirth) : null;
        const openRec = openRecordByChild.get(m.person.id);
        return {
          id: m.person.id,
          firstName: m.person.firstName,
          middleName: m.person.middleName,
          lastName: m.person.lastName,
          ageYears,
          schoolGrade: m.person.schoolGrade,
          hasAlerts,
          currentlyCheckedIn: openRec
            ? {
                sessionId: openRec.checkInSession.programId ?? openRec.checkInSession.eventId ?? openRec.id,
                programId: openRec.checkInSession.programId,
                eventId: openRec.checkInSession.eventId,
              }
            : null,
        };
      }),
    guardians: family.members
      .filter((m) => m.role === "AuthorisedGuardian" && m.person.personType === "Adult")
      .map((m) => ({
        id: m.person.id,
        firstName: m.person.firstName,
        middleName: m.person.middleName,
        lastName: m.person.lastName,
      })),
    sessions: activePrograms.map((p) => ({
      programId: p.programId,
      programName: p.programName,
      slug: p.slug,
      classCount: p.classes.length,
      firstScheduleTime: p.classes[0]?.scheduleStart ?? null,
      eventCount: p.events.length,
    })),
    todayLabel: `${dayLong(today.getDay())} (Day ${dayNumberOfWeek(today.getDay(), config.weekStartsOn)})`,
  };

  return <FamilyDetail initial={dto} />;
}

function computeAge(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : 0;
}
