import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getOrgConfig } from "@/lib/branding";
import { getFeatureFlags } from "@/lib/feature-flags";
import { BrandMark } from "@/components/domain/brand-mark";
import { KioskIdleReset } from "@/components/domain/kiosk-idle-reset";
import { OfflineIndicator } from "@/components/domain/offline-indicator";
import { InstallPrompt } from "@/components/domain/install-prompt";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Kiosk layout (Stage 6).
 *
 * Fullscreen, touch-first shell — NO standard app header/footer chrome.
 * Slim kiosk header (brand mark + app name) + a small "Exit" button (ghost,
 * bottom-corner-ish) + a tiny muted footer (org + "Powered by ChildCheck").
 *
 * Mounts the KioskIdleReset client component to bounce the kiosk back to
 * /kiosk after inactivity (default 90s + 10s warning).
 */
export default async function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [config, flags] = await Promise.all([getOrgConfig(), getFeatureFlags()]);
  const appName = config.branding.appName;
  const logoUrl = config.branding.logoUrl;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-primary/5 via-background to-background">
      <KioskIdleReset />
      <OfflineIndicator />
      <InstallPrompt variant="compact" />

      {/* Slim kiosk header */}
      <header className="border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                className="h-8 w-8 rounded-lg object-cover"
              />
            ) : (
              <BrandMark size="sm" />
            )}
            <span className="font-semibold text-base truncate">{appName}</span>
            {flags.kiosk_requires_login && (
              <span className="hidden sm:inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                Locked kiosk
              </span>
            )}
          </div>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href="/" aria-label="Exit kiosk and return to home">
              <ArrowLeft className="h-4 w-4" /> Exit
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col">{children}</main>

      {/* Minimal sticky kiosk footer */}
      <footer className="mt-auto border-t bg-background/85">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="truncate">{appName}</span>
          <span className="shrink-0">Powered by ChildCheck</span>
        </div>
      </footer>
    </div>
  );
}
