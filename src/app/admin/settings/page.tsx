import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { SettingsTabs } from "./settings-tabs";

export const dynamic = "force-dynamic";

/**
 * /admin/settings — Stage 2 admin console.
 *
 * Two tabs (shadcn Tabs):
 *   - Branding & Terminology  (logo, colours, app name, term overrides)
 *   - Feature Toggles         (every flag from PLAN.md §6)
 *
 * Sticky footer enforced by the /admin layout.
 */
export default async function SettingsPage() {
  const user = await requireRole("Admin");
  // Belt + braces — requireRole already redirects, but TS doesn't know.
  if (!user) redirect("/login?error=unauthorized");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
            <Link href="/admin">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Admin home
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rebrand the app and toggle features for this organisation.
          </p>
        </div>
      </div>

      <SettingsTabs />
    </div>
  );
}
