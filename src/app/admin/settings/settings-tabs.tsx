"use client";

import { useEffect, useState } from "react";
import { Palette, ToggleLeft, CalendarDays, Mail } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandingForm } from "./branding-form";
import { FlagsForm } from "./flags-form";
import { OrgTypeSelector } from "./org-type-selector";
import { CalendarForm } from "./calendar-form";
import { CodeSettingsForm } from "./code-settings-form";
import { EmailForm } from "./email-form";

/**
 * Hash-aware tabs for /admin/settings.
 *
 * Deep-links supported:
 *   #branding        → Branding & Terminology tab
 *   #calendar        → Calendar & Codes tab
 *   #flags           → Feature Toggles tab
 *   #email           → Email tab (SMTP config)
 *   #cat-<slug>      → Feature Toggles tab, scrolled to that category
 *                      (e.g. #cat-kiosk jumps to the "Kiosk" toggles)
 *
 * On mount: if the hash matches a known tab or a `cat-` category, activate
 * the right tab. After the tab renders, the browser's native scroll-to-anchor
 * lands on the category heading (which has `id="cat-<slug>"` + scroll-mt).
 */
const TAB_VALUES = ["branding", "calendar", "flags", "email"] as const;
type TabValue = (typeof TAB_VALUES)[number];

function hashToTab(hash: string): TabValue {
  const h = hash.replace(/^#/, "").toLowerCase();
  if (h === "calendar") return "calendar";
  if (h === "flags") return "flags";
  if (h === "email") return "email";
  if (h.startsWith("cat-")) return "flags";
  return "branding";
}

export function SettingsTabs() {
  // Lazy initial state: read the hash once on first client render so we open
  // the right tab immediately (no flash + no setState-in-effect).
  const [tab, setTab] = useState<TabValue>(() => {
    if (typeof window === "undefined") return "branding";
    return hashToTab(window.location.hash);
  });

  useEffect(() => {
    // If the hash is a category anchor inside the flags tab, the element may
    // not have been mounted when the browser first tried to scroll (shadcn Tabs
    // unmount inactive content). The lazy initial state above has now mounted
    // the flags tab, so scroll to the anchor.
    if (typeof window === "undefined") return;
    const h = window.location.hash;
    if (h.startsWith("#cat-")) {
      requestAnimationFrame(() => {
        const el = document.querySelector(h);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="w-full">
      <TabsList className="grid w-full sm:w-auto grid-cols-2 sm:grid-cols-4">
        <TabsTrigger value="branding" className="gap-1.5">
          <Palette className="h-4 w-4" /> <span className="hidden sm:inline">Branding &amp; Terminology</span>
          <span className="sm:hidden">Branding</span>
        </TabsTrigger>
        <TabsTrigger value="calendar" className="gap-1.5">
          <CalendarDays className="h-4 w-4" /> <span className="hidden sm:inline">Calendar &amp; Codes</span>
          <span className="sm:hidden">Calendar</span>
        </TabsTrigger>
        <TabsTrigger value="flags" className="gap-1.5">
          <ToggleLeft className="h-4 w-4" /> <span className="hidden sm:inline">Feature Toggles</span>
          <span className="sm:hidden">Flags</span>
        </TabsTrigger>
        <TabsTrigger value="email" className="gap-1.5">
          <Mail className="h-4 w-4" /> Email
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
      <TabsContent value="email" className="mt-4">
        <EmailForm />
      </TabsContent>
    </Tabs>
  );
}
