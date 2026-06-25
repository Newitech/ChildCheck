import Link from "next/link";
import {
  Users,
  CalendarRange,
  CalendarDays,
  DoorOpen,
  ScanLine,
  Palette,
  BarChart3,
  DatabaseBackup,
  ArrowUpDown,
  Ban,
  Settings,
  ArrowRight,
  Printer,
  Fingerprint,
  type LucideIcon,
} from "lucide-react";

import { getCurrentUser } from "@/lib/auth";
import { getOrgConfig } from "@/lib/branding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UpdatesCard } from "@/app/admin/updates-card";

export const dynamic = "force-dynamic";

interface SectionCard {
  icon: LucideIcon;
  title: string;
  desc: string;
  stage: number;
  /** If set, the card links to this route instead of showing "Coming soon". */
  href?: string;
}

const SECTIONS: SectionCard[] = [
  {
    icon: Users,
    title: "People & Families",
    desc: "Adults, children, family memberships, encrypted photos, WWCC tracking.",
    stage: 3,
    href: "/admin/people",
  },
  {
    icon: Palette,
    title: "Branding & Toggles",
    desc: "Organisation name, colours, terminology overrides, feature flags, org type.",
    stage: 2,
    href: "/admin/settings",
  },
  {
    icon: CalendarRange,
    title: "Programs & Classes",
    desc: "Sabbath School / Pathfinders / custom programs, rooms, schedules.",
    stage: 5,
    href: "/admin/programs",
  },
  {
    icon: ScanLine,
    title: "Kiosk configuration",
    desc: "Kiosk accounts, open vs locked mode, search fields, label printers.",
    stage: 6,
  },
  {
    icon: Printer,
    title: "Printers & Labels",
    desc: "Printer CRUD (browser / QZ Tray / thermal raw), room assignments, label template editor.",
    stage: 11,
    href: "/admin/printers",
  },
  {
    icon: BarChart3,
    title: "Reports",
    desc: "Headcounts, attendance trends, sign-in/sign-out history, exports.",
    stage: 10,
    href: "/admin/reports",
  },
  {
    icon: ArrowUpDown,
    title: "Import / Export",
    desc: "Bulk CSV import of people/families. Export for backups & migrations.",
    stage: 12,
    href: "/admin/data",
  },
  {
    icon: DatabaseBackup,
    title: "Backup & Restore",
    desc: "Encrypted, downloadable, restorable backups — scheduled or manual.",
    stage: 13,
    href: "/admin/backup",
  },
  {
    icon: Fingerprint,
    title: "Audit log",
    desc: "Tamper-evident, hash-chained record of every sensitive action. Verify chain integrity.",
    stage: 16,
    href: "/admin/audit",
  },
];

export default async function AdminHomePage() {
  const user = await getCurrentUser();
  const config = await getOrgConfig();
  const orgName = config.branding.appName;

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-2xl">
              Welcome, {user?.name ?? "Admin"}
            </CardTitle>
            <CardDescription>
              This is the ChildCheck admin console. Core people/program/kiosk
              management arrives across Stages 2&ndash;13.
            </CardDescription>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {(user?.roles ?? []).map((r) => (
                <Badge key={r} variant="secondary" className="text-[10px]">
                  {r}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/people">
                <Users className="mr-1.5 h-4 w-4" /> People
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/families">Families</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/blacklist">
                <Ban className="mr-1.5 h-4 w-4" /> Blacklist
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/programs">
                <CalendarRange className="mr-1.5 h-4 w-4" /> Programs
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/rooms">
                <DoorOpen className="mr-1.5 h-4 w-4" /> Rooms
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/printers">
                <Printer className="mr-1.5 h-4 w-4" /> Printers
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/events">
                <CalendarDays className="mr-1.5 h-4 w-4" /> Events
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/reports">
                <BarChart3 className="mr-1.5 h-4 w-4" /> Reports
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/data">
                <ArrowUpDown className="mr-1.5 h-4 w-4" /> Data
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/backup">
                <DatabaseBackup className="mr-1.5 h-4 w-4" /> Backup
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/audit">
                <Fingerprint className="mr-1.5 h-4 w-4" /> Audit
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/settings">
                <Settings className="mr-1.5 h-4 w-4" /> Settings
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/volunteer">Volunteer</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/kiosk">Open kiosk</Link>
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* System status */}
      <Card>
        <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-sm">
            <span className="text-muted-foreground">Organisation:</span>{" "}
            <span className="font-medium">{orgName}</span>
          </div>
          <Button asChild variant="ghost" size="sm" className="text-primary">
            <Link href="/admin/settings">
              Manage branding &amp; feature toggles <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Updates checker */}
      <UpdatesCard />

      {/* Sections grid */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold tracking-tight">Sections</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SECTIONS.map((s) => {
            const inner = (
              <>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <s.icon className="h-5 w-5" />
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      Stage {s.stage}
                    </Badge>
                  </div>
                  <CardTitle className="text-base mt-2">{s.title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    {s.desc}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <span className="inline-flex items-center text-xs text-muted-foreground">
                    {s.href ? "Open" : "Coming soon"}
                  </span>
                </CardContent>
              </>
            );
            if (s.href) {
              return (
                <Link
                  key={s.title}
                  href={s.href}
                  className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
                >
                  <Card className="h-full transition-shadow hover:shadow-md cursor-pointer">
                    {inner}
                  </Card>
                </Link>
              );
            }
            return (
              <Card key={s.title} className="h-full opacity-95" aria-disabled>
                {inner}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
