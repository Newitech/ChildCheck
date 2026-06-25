import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags";
import { getOrgConfig } from "@/lib/branding";
import { dayLong, dayNumberOfWeek } from "@/lib/week";
import { startOfDayUTC } from "@/lib/daily-code";
import { CheckoutFlow, type CheckoutFlowProps } from "./checkout-flow";

export const dynamic = "force-dynamic";

/**
 * /kiosk/family/[id]/checkout — Stage 8 multi-child check-out flow.
 *
 * Server component shell — loads the family + members (WITH medical fields,
 * because this page surfaces allergy/medical alerts at check-out selection —
 * the safety-critical surfacing that the search list deliberately omits),
 * today's currently-open CheckInRecords (so we can render "Already checked
 * out ✓" on each child row), and the family's adults (for the PIN flow +
 * override collector picker).
 *
 * Same access gate as the family detail page: in locked mode requires
 * Kiosk/Admin/Security; otherwise open.
 */
export default async function KioskCheckoutPage({
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
              photoPath: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!family) notFound();

  // Today's check-in records (open OR already checked out) for this family.
  const today = new Date();
  const dayStart = startOfDayUTC(today);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const todaysRecords = await db.checkInRecord.findMany({
    where: {
      familyId: family.id,
      checkedInAt: { gte: dayStart, lt: dayEnd },
    },
    include: {
      checkInSession: { select: { id: true, programId: true, eventId: true } },
      // Class + room lookups for display
    },
    orderBy: { checkedInAt: "asc" },
  });

  // Lookup className/roomName for each record's classId (denormalised string
  // display).
  const classIds = Array.from(
    new Set(todaysRecords.map((r) => r.classId).filter((x): x is string => !!x)),
  );
  const classes = classIds.length
    ? await db.groupClass.findMany({
        where: { id: { in: classIds } },
        select: { id: true, name: true, room: { select: { name: true } } },
      })
    : [];
  const classById = new Map(classes.map((c) => [c.id, c]));

  // Build child DTOs (WITH medical details — this is the check-out selection
  // screen, which is allowed to show them).
  //
  // For each child, find their MOST RELEVANT record today: prefer an OPEN
  // record (checkedOutAt null) so the operator can sign them out; if no open
  // record exists, fall back to the latest CLOSED record so the UI can show
  // "Already signed out ✓" + the method used.
  const childMembers = family.members.filter((m) => m.role === "Child");
  const children = childMembers.map((m) => {
    const ageYears = m.person.dateOfBirth ? computeAge(m.person.dateOfBirth) : null;
    const childRecords = todaysRecords
      .filter((r) => r.childPersonId === m.person.id)
      .sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime());
    const openRecord = childRecords.find((r) => !r.checkedOutAt) ?? null;
    const todaysRecord = openRecord ?? childRecords[0] ?? null;
    const className = todaysRecord?.classId
      ? classById.get(todaysRecord.classId)?.name ?? null
      : null;
    const roomName = todaysRecord?.classId
      ? classById.get(todaysRecord.classId)?.room?.name ?? null
      : null;
    return {
      id: m.person.id,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
      preferredName: m.person.preferredName,
      ageYears,
      schoolGrade: m.person.schoolGrade,
      allergies: m.person.allergies,
      medicalNotes: m.person.medicalNotes,
      hasPhoto: !!m.person.photoPath,
      // today's check-in record info, if any
      checkInRecordId: openRecord?.id ?? null,
      checkedOutAt: todaysRecord?.checkedOutAt
        ? todaysRecord.checkedOutAt.toISOString()
        : null,
      checkoutMethod: todaysRecord?.checkoutMethod ?? null,
      className,
      roomName,
    };
  });

  // Adult guardians (carers + authorised guardians) — for guardian PIN flow
  // and for override collector picker.
  const adults = family.members
    .filter(
      (m) =>
        m.person.personType === "Adult" &&
        (m.role === "PrimaryCarer" || m.role === "AuthorisedGuardian"),
    )
    .map((m) => ({
      id: m.person.id,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
      role: m.role,
      hasPhoto: !!m.person.photoPath,
    }));

  // Current user (may be null if anonymous kiosk). Used to show the override
  // tab + identify the staff authoriser.
  const currentUser = await getCurrentUser();
  const isStaff =
    !!currentUser &&
    (currentUser.roles.includes("Admin") ||
      currentUser.roles.includes("Security") ||
      currentUser.roles.includes("Teacher"));

  const props: CheckoutFlowProps = {
    familyId: family.id,
    familyName: family.familyName,
    todayLabel: `${dayLong(today.getDay())} (Day ${dayNumberOfWeek(today.getDay(), config.weekStartsOn)})`,
    children,
    adults,
    guardianPinSignin: flags.guardian_pin_signin === true,
    overrideCheckout: flags.override_checkout === true,
    photoVerification: flags.photo_verification === true,
    isStaff,
    staffName: currentUser?.name ?? null,
    dailyCodeLength: config.dailyCodeLength,
    dailyCodeCharset: config.dailyCodeCharset,
  };

  return <CheckoutFlow {...props} />;
}

function computeAge(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : 0;
}
