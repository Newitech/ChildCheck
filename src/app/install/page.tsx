import Link from "next/link";
import {
  ArrowLeft,
  Smartphone,
  Tablet,
  Monitor,
  Share,
  Plus,
  Download,
  Chrome,
  Apple,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandMark } from "@/components/domain/brand-mark";
import { getOrgConfig } from "@/lib/branding";

export const dynamic = "force-dynamic";

/**
 * /install — per-platform install instructions for the ChildCheck PWA.
 *
 * Stage 14. Linked from the home page footer ("Install app") and from the
 * InstallPrompt component on desktop browsers without beforeinstallprompt.
 */
export default async function InstallPage() {
  const config = await getOrgConfig();
  const appName = config.branding.appName;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BrandMark size="md" />
            <span className="font-semibold leading-tight truncate">{appName}</span>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-10 sm:py-14 space-y-8">
          <div className="text-center space-y-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Download className="h-6 w-6" />
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Install {appName} as an app
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              {appName} is a Progressive Web App — once installed it opens
              full-screen like a native app, works offline for queued
              check-ins, and lives on your Home Screen / Dock / desktop.
              Choose your platform below.
            </p>
          </div>

          {/* Why install */}
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Why install?
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground grid sm:grid-cols-3 gap-3">
              <div>
                <p className="font-medium text-foreground mb-1">Full-screen kiosk</p>
                <p>Opens without browser chrome — perfect for a check-in tablet.</p>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">Offline-ready</p>
                <p>Check-ins are queued locally and sync automatically when reconnected.</p>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">Home-screen launch</p>
                <p>One tap from the Home Screen — no address bar typing.</p>
              </div>
            </CardContent>
          </Card>

          {/* Per-platform instructions */}
          <div className="grid md:grid-cols-2 gap-4">
            <PlatformCard
              icon={<Smartphone className="h-5 w-5" />}
              vendorIcon={<Apple className="h-3.5 w-3.5" />}
              title="iPhone / iPad"
              subtitle="iOS Safari"
              steps={[
                <>
                  Open this page in <strong>Safari</strong> (not Chrome on iOS —
                  only Safari supports Add to Home Screen).
                </>,
                <>
                  Tap the <Share className="inline h-3.5 w-3.5 align-text-bottom" />{" "}
                  <strong>Share</strong> button in the toolbar.
                </>,
                <>
                  Scroll the sheet and tap{" "}
                  <Plus className="inline h-3.5 w-3.5 align-text-bottom" />{" "}
                  <strong>Add to Home Screen</strong>.
                </>,
                <>
                  Tap <strong>Add</strong>. An {appName} icon appears on your
                  Home Screen — tap it to launch full-screen.
                </>,
              ]}
            />

            <PlatformCard
              icon={<Smartphone className="h-5 w-5" />}
              vendorIcon={<Chrome className="h-3.5 w-3.5" />}
              title="Android phone / tablet"
              subtitle="Chrome or Edge"
              steps={[
                <>
                  Open this site in <strong>Chrome</strong> (or Edge) on your
                  Android device.
                </>,
                <>
                  Tap the <strong>three-dot menu</strong> in the top-right.
                </>,
                <>
                  Tap <strong>Install app</strong> (or &ldquo;Add to Home
                  screen&rdquo; on older versions).
                </>,
                <>
                  Confirm. {appName} now appears in your app drawer and Home
                  Screen.
                </>,
              ]}
            />

            <PlatformCard
              icon={<Monitor className="h-5 w-5" />}
              vendorIcon={<Chrome className="h-3.5 w-3.5" />}
              title="Windows / Linux desktop"
              subtitle="Chrome or Edge"
              steps={[
                <>
                  Open this site in <strong>Chrome</strong> or{" "}
                  <strong>Microsoft Edge</strong>.
                </>,
                <>
                  Look for the <Download className="inline h-3.5 w-3.5 align-text-bottom" />{" "}
                  <strong>install icon</strong> in the far right of the address
                  bar.
                </>,
                <>
                  Click it and choose <strong>Install</strong>. (If you don&apos;t
                  see it, open the browser menu → <strong>Cast, save, share</strong>{" "}
                  → <strong>Install {appName}</strong>.)
                </>,
                <>
                  {appName} opens in its own window — pin it to the taskbar for
                  quick access.
                </>,
              ]}
            />

            <PlatformCard
              icon={<Monitor className="h-5 w-5" />}
              vendorIcon={<Apple className="h-3.5 w-3.5" />}
              title="macOS"
              subtitle="Safari or Chrome"
              steps={[
                <>
                  <strong>Safari (recommended):</strong> open this site, then
                  click <Share className="inline h-3.5 w-3.5 align-text-bottom" />{" "}
                  <strong>Share</strong> in the toolbar →{" "}
                  <strong>Add to Dock</strong>.
                </>,
                <>
                  <strong>Chrome:</strong> open the three-dot menu →{" "}
                  <strong>Cast, save, share</strong> →{" "}
                  <strong>Install {appName}</strong>.
                </>,
                <>
                  The Dock icon launches {appName} in a clean, full-screen window.
                </>,
                <>
                  Tip: set the Dock icon to <em>Options → Keep in Dock</em> so it
                  stays put.
                </>,
              ]}
            />
          </div>

          {/* Tablet aside */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Tablet className="h-4 w-4 text-primary" />
                Using a kiosk tablet?
              </CardTitle>
              <CardDescription className="text-xs">
                Recommended setup for an always-on check-in tablet.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground space-y-1.5">
              <p>
                • Install the PWA per the platform instructions above so it opens
                full-screen with no browser chrome.
              </p>
              <p>
                • Turn on <strong>Guided Access</strong> (iOS) or{" "}
                <strong>Screen Pinning</strong> (Android) to lock the device to{" "}
                {appName}.
              </p>
              <p>
                • Disable screen auto-sleep so the kiosk is always ready.
              </p>
              <p>
                • Once installed, the kiosk keeps working through network
                blips — queued check-ins sync automatically.
              </p>
            </CardContent>
          </Card>

          <div className="text-center pt-4">
            <Button asChild size="lg">
              <Link href="/kiosk">Open the kiosk</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 text-xs text-muted-foreground text-center">
          {appName} · self-hosted child check-in · PWA install instructions
        </div>
      </footer>
    </div>
  );
}

function PlatformCard({
  icon,
  vendorIcon,
  title,
  subtitle,
  steps,
}: {
  icon: React.ReactNode;
  vendorIcon: React.ReactNode;
  title: string;
  subtitle: string;
  steps: React.ReactNode[];
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {vendorIcon} {subtitle}
          </span>
        </div>
        <CardTitle className="text-lg mt-2">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ol className="space-y-2 text-sm text-muted-foreground">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
