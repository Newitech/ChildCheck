import Link from "next/link";
import {
  Users,
  UserCog,
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
  Plug,
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
  /** If set, the card links to this route. */
  href?: string;
}

const SECTIONS: SectionCard[] = [
  {
    icon: Users,
    title: "People & Families",
    desc: "Adults, children, family memberships, encrypted photos, WWCC tracking.",
    href: "/admin/people",
  },
  {
    icon: UserCog,
    title: "Users & Roles",
    desc: "Login accounts, roles (Admin/Teacher/Volunteer/Kiosk/Security/PeopleManager), passwords + PINs.",
    href: "/admin/users",
  },
  {
    icon: Palette,
    title: "Branding & Toggles",
    desc: "Organisation name, colours, terminology overrides, feature flags, org type.",
    href: "/admin/settings",
  },
  {
    icon: CalendarRange,
    title: "Programs & Classes",
    desc: "Sabbath School / Pathfinders / custom programs, rooms, schedules.",
    href: "/admin/programs",
  },
  {
    icon: ScanLine,
    title: "Kiosk configuration",
    desc: "Open vs locked mode, guardian PIN sign-in, label printing, photo verification — all feature toggles.",
    href: "/admin/settings#cat-kiosk",
  },
  {
    icon: Printer,
    title: "Printers & Labels",
    desc: "Printer CRUD (browser / QZ Tray / thermal raw), room assignments, label template editor.",
    href: "/admin/printers",
  },
  {
    icon: BarChart3,
    title: "Reports",
    desc: "Headcounts, attendance trends, sign-in/sign-out history, exports.",
    href: "/admin/reports",
  },
  {
    icon: ArrowUpDown,
    title: "Import / Export",
    desc: "Bulk CSV import of people/families. Export for backups & migrations.",
    href: "/admin/data",
  },
  {
    icon: DatabaseBackup,
    title: "Backup & Restore",
    desc: "Encrypted, downloadable, restorable backups — scheduled or manual.",
    href: "/admin/backup",
  },
  {
    icon: Fingerprint,
    title: "Audit log",
    desc: "Tamper-evident, hash-chained record of every sensitive action. Verify chain integrity.",
    href: "/admin/audit",
  },
  {
    icon: Plug,
    title: "Elvanto connector",
    desc: "Import/export people & families from/to Elvanto CSV. Dry-run preview, idempotent matching, quick-add.",
    href: "/admin/integrations/elvanto",
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
              Manage people, families, programs, the kiosk, reports, backups and security.
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
              <Link href="/admin/users">
                <UserCog className="mr-1.5 h-4 w-4" /> Users
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

      {/* Updates + system status row */}
      <section>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <UpdatesCard />
          <Card className="sm:col-span-1 lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Settings className="h-5 w-5" />
                </span>
              </div>
              <CardTitle className="text-base mt-2">Organisation</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                <span className="text-muted-foreground">Active org:</span>{" "}
                <span className="font-medium text-foreground">{orgName}</span>
                <br />
                Manage branding, terminology, feature flags, calendar week-start
                and the daily code format.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/settings">
                  Manage branding &amp; feature toggles{" "}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

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
                  </div>
                  <CardTitle className="text-base mt-2">{s.title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    {s.desc}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <span className="inline-flex items-center text-xs text-muted-foreground">
                    {s.href ? "Open" : "Not yet available"}
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
