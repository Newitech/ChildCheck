import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";

import { getOrgConfig } from "@/lib/branding";
import { getGuardian } from "@/lib/guardian-session";
import { db } from "@/lib/db";
import { BrandMark } from "@/components/domain/brand-mark";
import { ThemeToggle } from "@/components/domain/theme-toggle";
import { Button } from "@/components/ui/button";
import { signOutGuardian } from "./signout-action";

export const dynamic = "force-dynamic";

/**
 * Authenticated guardian portal layout.
 *
 * Lives inside the (authed) route group so it only wraps protected pages
 * (e.g. /guardian/family) — NOT /guardian itself, which is the public sign-in
 * page. Wrapping the sign-in page caused an infinite redirect loop
 * (layout → redirect("/guardian") → layout …), which surfaced as a Turbopack
 * "Performance.measure negative timestamp" error.
 */
export default async function GuardianAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const g = await getGuardian();
  if (!g) {
    redirect("/guardian");
  }

  const [config, person] = await Promise.all([
    getOrgConfig(),
    db.person.findUnique({
      where: { id: g.personId },
      select: { firstName: true, lastName: true },
    }),
  ]);

  const appName = config.branding.appName;
  const carerName = person
    ? `${person.firstName} ${person.lastName}`.trim()
    : "Guardian";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandMark size="sm" />
            <span className="font-semibold text-base truncate">{appName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {carerName}
            </span>
            <ThemeToggle />
            <form action={signOutGuardian}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col">{children}</main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-4 text-center text-xs text-muted-foreground">
          All data stays on your hardware.
        </div>
      </footer>
    </div>
  );
}
