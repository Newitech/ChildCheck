import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getOrgConfig } from "@/lib/branding";
import { BrandMark } from "@/components/domain/brand-mark";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/domain/theme-toggle";
import { GuardianSigninForm } from "./guardian-signin-form";

export const dynamic = "force-dynamic";

/**
 * Guardian sign-in page (server shell).
 *
 * Step 1: find your family (search by name / phone / email).
 * Step 2: enter your personal guardian PIN.
 * On success → redirect to /guardian/family.
 */
export default async function GuardianSigninPage() {
  const config = await getOrgConfig();
  const appName = config.branding.appName;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-primary/5 via-background to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <BrandMark size="sm" /> {appName}
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link href="/">
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Home
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        <GuardianSigninForm orgName={appName} />
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-4 text-center text-xs text-muted-foreground">
          All data stays on your hardware.
        </div>
      </footer>
    </div>
  );
}
