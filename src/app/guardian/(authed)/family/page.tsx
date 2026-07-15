import { redirect } from "next/navigation";

import { getGuardian } from "@/lib/guardian-session";
import { FamilyDashboard } from "./family-dashboard";

export const dynamic = "force-dynamic";

/**
 * Guardian family dashboard (server shell).
 *
 * The layout already validated the session; this page just double-checks and
 * renders the client dashboard.
 */
export default async function GuardianFamilyPage() {
  const g = await getGuardian();
  if (!g) redirect("/guardian");

  return (
    <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 space-y-6">
      <FamilyDashboard />
    </div>
  );
}
