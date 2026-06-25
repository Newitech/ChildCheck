import { getCurrentUser } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags";
import { getOrgConfig } from "@/lib/branding";
import { getActiveProgramsForDate, type ActiveProgramForDate } from "@/lib/sessions";
import { dayLong, dayNumberOfWeek } from "@/lib/week";
import {
  VisitorCheckInFlow,
  type VisitorCheckInFlowProps,
} from "./visitor-flow";

export const dynamic = "force-dynamic";

/**
 * /kiosk/visitor — Stage 7 visitor quick-add + check-in.
 *
 * Same access gate as the rest of the kiosk: in locked mode
 * (kiosk_requires_login ON) requires Kiosk/Admin/Security; otherwise open.
 *
 * Loads today's active programs + standalone events for the session selector
 * and the `visitors_add_to_db` flag so the UI knows whether to show the
 * "add to regular DB" checkbox.
 */
export default async function KioskVisitorPage() {
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

  const today = new Date();
  const activePrograms: ActiveProgramForDate[] = await getActiveProgramsForDate(today);

  const props: VisitorCheckInFlowProps = {
    todayLabel: `${dayLong(today.getDay())} (Day ${dayNumberOfWeek(today.getDay(), config.weekStartsOn)})`,
    activePrograms: activePrograms.map((p) => ({
      programId: p.programId,
      programName: p.programName,
      slug: p.slug,
      classCount: p.classes.length,
      firstScheduleTime: p.classes[0]?.scheduleStart ?? null,
      eventCount: p.events.length,
      events: p.events.map((e) => ({ eventId: e.eventId, eventName: e.eventName })),
    })),
    visitorsAddToDbFlag: flags.visitors_add_to_db === true,
    requiresLogin,
  };

  return <VisitorCheckInFlow {...props} />;
}
