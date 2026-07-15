import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { getCurrentUser } from "@/lib/auth";
import { BrandMark } from "@/components/domain/brand-mark";
import { SignOutButton } from "@/components/domain/sign-out-button";
import { UserMenu } from "@/components/domain/user-menu";
import { IdleTimeout } from "@/components/domain/idle-timeout";
import { ThemeToggle } from "@/components/domain/theme-toggle";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Admin console layout.
 *
 * Allowed roles: Admin, PeopleManager, Security.
 *   - Kiosk-only users → /kiosk
 *   - Teacher / Volunteer (no admin-side role) → /volunteer
 *   - No session → /login?callback=/admin
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?callback=/admin");
  }

  const isAdminLike =
    user.roles.includes("Admin") ||
    user.roles.includes("PeopleManager") ||
    user.roles.includes("Security");

  if (!isAdminLike) {
    if (user.roles.includes("Kiosk")) {
      redirect("/kiosk");
    }
    redirect("/volunteer");
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted/20">
      <IdleTimeout />
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BrandMark size="md" />
            <div className="min-w-0">
              <p className="font-semibold leading-tight truncate flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" /> Admin
              </p>
              <p className="text-xs text-muted-foreground leading-tight truncate hidden sm:block">
                ChildCheck console
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu user={user} />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
          {children}
        </div>
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <BrandMark size="sm" />
            <span>ChildCheck · admin</span>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/volunteer">Volunteer</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/">Home</Link>
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
