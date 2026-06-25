import Link from "next/link";
import { ShieldCheck, ScanLine, Users, LayoutDashboard, Lock, WifiOff, HeartPulse, Printer, QrCode, Download, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/domain/brand-mark";
import { InstallPrompt } from "@/components/domain/install-prompt";
import { getOrgConfig, t } from "@/lib/branding";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = await getOrgConfig();
  const { branding, terminology } = config;

  let setupMode = false;
  try {
    setupMode = (await db.user.count()) === 0;
  } catch {
    setupMode = true; // DB not ready → treat as setup.
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/30">
      {/* Install prompt (top banner — shown when installable / iOS / desktop) */}
      <InstallPrompt />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BrandMark size="md" />
            <div className="min-w-0">
              <p className="font-semibold leading-tight truncate">{branding.appName}</p>
              <p className="text-xs text-muted-foreground leading-tight truncate hidden sm:block">{branding.tagline}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm" variant="default">
              <Link href="/kiosk">Open Kiosk</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-10 sm:py-16">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div className="space-y-6">
              <Badge variant="secondary" className="gap-1.5">
                <Lock className="h-3.5 w-3.5" /> Self-hosted · Private · Secure
              </Badge>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
                Safe child check-in &amp; check-out, <span className="text-primary">kept on your own hardware</span>.
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl">
                A self-hosted system for churches, clubs, schools and childcare.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg" className="h-12 px-6 text-base">
                  <Link href="/kiosk">
                    <ScanLine className="mr-2 h-5 w-5" /> Start at a Kiosk
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base">
                  <Link href={setupMode ? "/setup" : "/login"}>
                    {setupMode ? "Finish setup" : "Admin / Volunteer sign-in"}
                  </Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: on your phone or desktop, use your browser&apos;s &ldquo;Install app&rdquo; / &ldquo;Add to Home Screen&rdquo;
                to run {branding.appName} like a native app.
              </p>
            </div>

            {/* Portal cards */}
            <div className="grid sm:grid-cols-2 gap-4">
              <PortalCard
                href="/kiosk"
                icon={ScanLine}
                title="Kiosk"
                desc="Touch-friendly check-in & check-out. Search a family, multi-child check-in, get a daily code."
                cta="Open kiosk"
                tone="primary"
              />
              <PortalCard
                href="/login"
                icon={Users}
                title="Guardian"
                desc="Carers & authorised guardians manage their family, PIN, and authorised collectors."
                cta="Guardian area"
              />
              <PortalCard
                href="/login"
                icon={LayoutDashboard}
                title="Volunteer"
                desc="Live room rosters, headcounts, manual check-out and session reports."
                cta="Volunteer dashboard"
              />
              <PortalCard
                href="/login"
                icon={ShieldCheck}
                title="Admin"
                desc="People, families, programs, classes, branding, feature toggles, backups."
                cta="Admin console"
              />
            </div>
          </div>
        </section>

        {/* Feature grid */}
        <section className="border-t bg-card/40">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-12">
            <div className="text-center max-w-2xl mx-auto mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Everything the check-in room needs</h2>
              <p className="text-muted-foreground mt-2">
                Modelled on Rock RMS &amp; Elvanto check-in — focused, opinionated, and configurable from the dashboard.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Feature icon={ShieldCheck} title="Authorised guardians" desc="Add grandparents, aunts & uncles who may sign children in/out — without edit rights on the family. Maintain a blacklist of blocked collectors." />
              <Feature icon={Lock} title="Security roles" desc="Admin, Security, Teacher, Volunteer, Kiosk & People-Manager roles — all linked from People records, sharing one set of credentials." />
              <Feature icon={ScanLine} title="Daily 3-digit code" desc="Each family gets a random code at check-in for lightning-fast, secure check-out. Visible to every authorised carer who signs in." />
              <Feature icon={Printer} title="Labels & code slips" desc="Optional name labels for children and signout-code slips — printed to the right queue for each room." />
              <Feature icon={HeartPulse} title="Allergy & medical alerts" desc="Critical alerts surface on the kiosk the moment a child is selected. Visibility scoped by role." />
              <Feature icon={LayoutDashboard} title="Multi-room check-in" desc="Sign siblings into different classes in one action — tick-boxes, not drop-downs." />
              <Feature icon={WifiOff} title="Offline-resilient" desc="The kiosk keeps working through network blips and resyncs when connectivity returns." />
              <Feature icon={Users} title="Visitors & first-timers" desc="Quick-add a visitor family for the day — with an option to keep them out of the regular database." />
              <Feature icon={QrCode} title="QR check-in (roadmap)" desc="A unique family QR code for pre-check is designed-for and coming in a future phase." />
            </div>
          </div>
        </section>

        {/* Programmes strip */}
        <section className="border-t">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-12">
            <div className="grid md:grid-cols-3 gap-6 items-center">
              <div className="md:col-span-1">
                <h2 className="text-2xl font-bold tracking-tight">Built for Sabbath programmes — and beyond</h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  Defaults target Seventh-Day Adventist ministries. Rename any term from the Admin Dashboard to serve
                  a Sunday church, Scouts troop, playgroup, school or childcare centre.
                </p>
              </div>
              <div className="md:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <ProgrammePill label={terminology.program_sabbath_school} />
                <ProgrammePill label={terminology.program_pathfinders} />
                <ProgrammePill label={terminology.program_adventurers} />
                <ProgrammePill label={terminology.program_community_childcare} />
                <ProgrammePill label={terminology.event_plural} />
                <ProgrammePill label="Custom programmes" />
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Sticky footer */}
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <BrandMark size="sm" />
            <span>
              {branding.appName} · self-hosted child check-in
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/install"
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Install app
            </Link>
            <p className="text-xs">
              All data stays on your hardware. © {new Date().getFullYear()} {branding.organisation ?? branding.appName}.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PortalCard({
  href,
  icon: Icon,
  title,
  desc,
  cta,
  tone,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  cta: string;
  tone?: "primary";
}) {
  return (
    <Card className={`h-full transition-shadow hover:shadow-md ${tone === "primary" ? "border-primary/40 ring-1 ring-primary/20" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          {tone === "primary" && <Badge variant="default" className="text-[10px]">Kiosk-ready</Badge>}
        </div>
        <CardTitle className="text-lg mt-2">{title}</CardTitle>
        <CardDescription className="text-sm leading-relaxed">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Button asChild variant={tone === "primary" ? "default" : "outline"} size="sm" className="w-full">
          <Link href={href}>{cta}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function ProgrammePill({ label }: { label: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center text-sm font-medium">
      {label}
    </div>
  );
}
