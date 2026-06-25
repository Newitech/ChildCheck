import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Palette, ToggleLeft, CalendarDays } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandingForm } from "./branding-form";
import { FlagsForm } from "./flags-form";
import { OrgTypeSelector } from "./org-type-selector";
import { CalendarForm } from "./calendar-form";
import { CodeSettingsForm } from "./code-settings-form";

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

      <Tabs defaultValue="branding" className="w-full">
        <TabsList className="grid w-full sm:w-auto grid-cols-3">
          <TabsTrigger value="branding" className="gap-1.5">
            <Palette className="h-4 w-4" /> Branding &amp; Terminology
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1.5">
            <CalendarDays className="h-4 w-4" /> Calendar &amp; Codes
          </TabsTrigger>
          <TabsTrigger value="flags" className="gap-1.5">
            <ToggleLeft className="h-4 w-4" /> Feature Toggles
          </TabsTrigger>
        </TabsList>

        <TabsContent value="branding" className="mt-4 space-y-6">
          <OrgTypeSelector />
          <BrandingForm />
        </TabsContent>
        <TabsContent value="calendar" className="mt-4 space-y-6">
          <CalendarForm />
          <CodeSettingsForm />
        </TabsContent>
        <TabsContent value="flags" className="mt-4">
          <FlagsForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
