import { getOrgConfig } from "@/lib/branding";
import { getFeatureFlags } from "@/lib/feature-flags";
import { getCurrentUser } from "@/lib/auth";
import { getActiveProgramsForDate } from "@/lib/sessions";
import { dayLong, dayNumberOfWeek } from "@/lib/week";
import { KioskLock } from "./kiosk-lock";
import { KioskSearch, type KioskSearchProps } from "./kiosk-search";

export const dynamic = "force-dynamic";

/**
 * /kiosk — Stage 6 kiosk home.
 *
 * Open mode (kiosk_requires_login OFF): render the search screen directly.
 * Locked mode (kiosk_requires_login ON): require a session with role Kiosk /
 * Admin / Security. If no qualifying session, render the KioskLock PIN pad.
 *
 * Either way, we also pre-compute today's active programs (server-side) and
 * pass them to the search screen so it can render the "Today's sessions"
 * panel without an extra round-trip.
 */
export default async function KioskHomePage() {
  const [config, flags] = await Promise.all([getOrgConfig(), getFeatureFlags()]);
  const requiresLogin = flags.kiosk_requires_login === true;

  let authed = false;
  if (requiresLogin) {
    const user = await getCurrentUser();
    authed =
      !!user &&
      (user.roles.includes("Kiosk") ||
        user.roles.includes("Admin") ||
        user.roles.includes("Security"));
  }

  // Today's sessions — computed server-side once.
  const today = new Date();
  const activePrograms = await getActiveProgramsForDate(today);
  const weekStartsOn = config.weekStartsOn;
  const dayNum = dayNumberOfWeek(today.getDay(), weekStartsOn);
  const dayName = dayLong(today.getDay());

  const searchProps: KioskSearchProps = {
    orgName: config.branding.appName,
    todayLabel: `${dayName} (Day ${dayNum})`,
    activePrograms: activePrograms.map((p) => ({
      programId: p.programId,
      programName: p.programName,
      slug: p.slug,
      classCount: p.classes.length,
      firstScheduleTime: p.classes[0]?.scheduleStart ?? null,
      eventCount: p.events.length,
    })),
  };

  if (requiresLogin && !authed) {
    return <KioskLock orgName={config.branding.appName} />;
  }

  return <KioskSearch {...searchProps} />;
}
