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
  // Always start on "branding" so the server-rendered HTML matches the first
  // client render (this page is force-dynamic + auth-gated, so it's SSR'd).
  // The hash is read AFTER mount in the effect below — reading it in a lazy
  // useState initializer is fragile under Next App Router client-side nav,
  // where window.location.hash isn't committed yet at mount time, which left
  // the tab stuck on Branding for hash deep-links like #cat-kiosk.
  const [tab, setTab] = useState<TabValue>("branding");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const apply = (): void => {
      const h = window.location.hash;
      setTab(hashToTab(h));
    };

    // Activate the right tab for the current hash now that the URL is settled.
    apply();

    // shadcn Tabs unmount inactive content, so a #cat-<slug> anchor won't exist
    // in the DOM until AFTER the flags tab renders (one rAF after setTab).
    // Also, FlagsForm fetches its data async and shows a spinner until then,
    // so the anchor may still be absent on the first frame — retry a few times.
    const scrollToCat = (hash: string): void => {
      let tries = 0;
      const attempt = (): void => {
        const el = document.querySelector(hash);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        if (++tries < 30) requestAnimationFrame(attempt); // ~0.5s @ 60fps
      };
      attempt();
    };

    const h = window.location.hash;
    if (h.startsWith("#cat-")) {
      // Wait one frame for the flags tab to mount before scrolling.
      requestAnimationFrame(() => scrollToCat(h));
    }

    // Keep the tab in sync if the hash changes while already on this page
    // (e.g. clicking the in-page category chips, or another deep-link).
    const onHashChange = (): void => {
      apply();
      const nh = window.location.hash;
      if (nh.startsWith("#cat-")) {
        requestAnimationFrame(() => scrollToCat(nh));
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
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
