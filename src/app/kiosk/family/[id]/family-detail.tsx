"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertTriangle,
  Users,
  Baby,
  ShieldCheck,
  CalendarClock,
  Lock,
  LogIn,
  LogOut,
  CheckCircle2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTerminology } from "@/hooks/use-terminology";
import { formatFullName } from "@/lib/people";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface KioskSessionSummary {
  programId: string | null;
  programName: string;
  slug: string | null;
  classCount: number;
  firstScheduleTime: string | null;
  eventCount: number;
}

export interface KioskFamilyMember {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
}

export interface KioskChildCurrentlyCheckedIn {
  sessionId: string;
  programId: string | null;
  eventId: string | null;
}

export interface KioskChild extends KioskFamilyMember {
  ageYears: number | null;
  schoolGrade: string | null;
  hasAlerts: boolean;
  currentlyCheckedIn: KioskChildCurrentlyCheckedIn | null;
}

export interface KioskFamilyDetailDTO {
  id: string;
  familyName: string;
  hasFamilyBlacklist: boolean;
  primaryCarers: KioskFamilyMember[];
  children: KioskChild[];
  guardians: KioskFamilyMember[];
  sessions: KioskSessionSummary[];
  todayLabel: string;
}

export function FamilyDetail({ initial }: { initial: KioskFamilyDetailDTO }) {
  const router = useRouter();
  const { t } = useTerminology();
  const hasAlerts = initial.hasFamilyBlacklist || initial.children.some((c) => c.hasAlerts);

  return (
    <div className="flex-1 flex flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 flex-1 flex flex-col gap-5">
        {/* Back button */}
        <div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-12 -ml-2 text-muted-foreground"
          >
            <Link href="/kiosk">
              <ArrowLeft className="mr-1.5 h-5 w-5" /> Back to search
            </Link>
          </Button>
        </div>

        {/* Family header */}
        <div className="flex items-center gap-3">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Users className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight truncate">
                {initial.familyName}
              </h1>
              <Badge variant="secondary">{t("family")}</Badge>
              {initial.children.some((c) => c.currentlyCheckedIn) && (
                <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                  <CheckCircle2 className="h-3 w-3" />
                  {initial.children.filter((c) => c.currentlyCheckedIn).length} checked in
                </Badge>
              )}
              {hasAlerts && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" /> Alerts
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {initial.primaryCarers.length} {initial.primaryCarers.length === 1 ? t("carer") : t("carer_plural")}
              {" · "}
              {initial.children.length} {initial.children.length === 1 ? t("child") : t("child_plural")}
              {initial.guardians.length > 0 && (
                <>
                  {" · "}
                  {initial.guardians.length} {initial.guardians.length === 1 ? t("guardian") : t("guardian_plural")}
                </>
              )}
            </p>
          </div>
        </div>

        {/* Today's sessions selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              Today&apos;s sessions
            </CardTitle>
            <CardDescription className="text-xs">
              {initial.todayLabel} — pick one to start check-in.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {initial.sessions.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  No scheduled sessions today. You can still check in to an
                  Event from the check-in screen.
                </p>
                <Button asChild variant="outline" size="sm" className="h-10">
                  <Link href={`/kiosk/family/${initial.id}/checkin`}>
                    Pick a session at check-in →
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {initial.sessions.map((s) => (
                  <button
                    key={s.programId ?? "standalone"}
                    type="button"
                    onClick={() => router.push(`/kiosk/family/${initial.id}/checkin`)}
                    className="rounded-lg border bg-muted/30 hover:bg-accent/40 transition-colors p-3 text-left"
                  >
                    <p className="font-medium text-sm">{s.programName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {s.programId === null
                        ? `${s.eventCount} event${s.eventCount === 1 ? "" : "s"}`
                        : s.firstScheduleTime
                          ? `${s.classCount} ${t("group_plural").toLowerCase()} · ${s.firstScheduleTime}`
                          : `${s.classCount} ${t("group_plural").toLowerCase()}`}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Primary carers */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
            <Users className="h-4 w-4" /> {t("carer_plural")}
          </h2>
          <div className="grid sm:grid-cols-2 gap-2">
            {initial.primaryCarers.length === 0 && (
              <Card>
                <CardContent className="py-4 text-sm text-muted-foreground">
                  No {t("carer_plural").toLowerCase()} on file.
                </CardContent>
              </Card>
            )}
            {initial.primaryCarers.map((c) => (
              <MemberRow
                key={c.id}
                firstName={c.firstName}
                middleName={c.middleName}
                lastName={c.lastName}
              />
            ))}
          </div>
        </section>

        {/* Children */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
            <Baby className="h-4 w-4" /> {t("child_plural")}
          </h2>
          <div className="grid sm:grid-cols-2 gap-2">
            {initial.children.length === 0 && (
              <Card>
                <CardContent className="py-4 text-sm text-muted-foreground">
                  No {t("child_plural").toLowerCase()} on file.
                </CardContent>
              </Card>
            )}
            {initial.children.map((c) => (
              <div
                key={c.id}
                className={`rounded-xl border bg-card p-3 flex items-center gap-3 ${
                  c.currentlyCheckedIn ? "ring-1 ring-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20" : ""
                }`}
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                  <Baby className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {formatFullName(c)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.ageYears !== null ? `${c.ageYears} yrs` : "Age unknown"}
                    {c.schoolGrade ? ` · ${c.schoolGrade}` : ""}
                  </p>
                </div>
                {c.currentlyCheckedIn ? (
                  <Badge className="gap-1 shrink-0 bg-emerald-600 hover:bg-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> Checked in
                  </Badge>
                ) : c.hasAlerts ? (
                  <Badge variant="destructive" className="gap-1 shrink-0">
                    <AlertTriangle className="h-3 w-3" /> Alert
                  </Badge>
                ) : null}
              </div>
            ))}
          </div>
          {hasAlerts && (
            <p className="text-xs text-muted-foreground px-1">
              Alert details are shown at check-in once a session is selected.
            </p>
          )}
        </section>

        {/* Authorised guardians */}
        {initial.guardians.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4" /> {t("guardian_plural")}
            </h2>
            <div className="grid sm:grid-cols-2 gap-2">
              {initial.guardians.map((g) => (
                <MemberRow
                  key={g.id}
                  firstName={g.firstName}
                  middleName={g.middleName}
                  lastName={g.lastName}
                />
              ))}
            </div>
          </section>
        )}

        {/* Check-in / Check-out CTAs */}
        <div className="grid sm:grid-cols-2 gap-3 pt-2">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block">
                  <Button
                    onClick={() => router.push(`/kiosk/family/${initial.id}/checkin`)}
                    className="w-full h-16 text-base"
                    size="lg"
                  >
                    <LogIn className="mr-2 h-5 w-5" /> Check in
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Opens the multi-child check-in flow</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block">
                  <Button
                    onClick={() => router.push(`/kiosk/family/${initial.id}/checkout`)}
                    variant="outline"
                    className="w-full h-16 text-base"
                    size="lg"
                  >
                    <LogOut className="mr-2 h-5 w-5" /> Check out
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Opens the multi-child check-out flow</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Stage info banner */}
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          <Lock className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            Family summary view. Multi-child check-in and three-method
            check-out (code / PIN / override) are live — tap Check out to sign
            children out using today&apos;s daily code, your guardian PIN, or
            (for staff) a supervisor override.
          </p>
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  firstName,
  middleName,
  lastName,
}: {
  firstName: string;
  middleName: string | null;
  lastName: string;
}) {
  const fullName = formatFullName({ firstName, middleName, lastName });
  const initials = `${(firstName[0] ?? "").toUpperCase()}${(lastName[0] ?? "").toUpperCase()}`;
  return (
    <div className="rounded-xl border bg-card p-3 flex items-center gap-3">
      <span
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold shrink-0"
        aria-hidden
      >
        {initials || "?"}
      </span>
      <p className="font-medium truncate">{fullName}</p>
    </div>
  );
}
