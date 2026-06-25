"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Baby,
  AlertTriangle,
  HeartPulse,
  ShieldCheck,
  CalendarClock,
  CheckCircle2,
  Printer,
  Camera,
  KeyRound,
  Lock,
  CloudUpload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTerminology } from "@/hooks/use-terminology";
import { executePrint } from "@/lib/print-client";
import type { PrintResult } from "@/lib/printing";

export interface CheckInFlowClass {
  classId: string;
  className: string;
  roomName: string | null;
  scheduleStart: string;
  scheduleEnd: string | null;
}
export interface CheckInFlowProgram {
  programId: string | null;
  programName: string;
  slug: string | null;
  firstScheduleTime: string | null;
  classes: CheckInFlowClass[];
  events: { eventId: string; eventName: string }[];
}
export interface CheckInFlowChild {
  id: string;
  firstName: string;
  lastName: string;
  ageYears: number | null;
  schoolGrade: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  currentlyCheckedIn: {
    sessionId: string;
    programId: string | null;
    eventId: string | null;
  } | null;
}
export interface CheckInFlowAdult {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface CheckInFlowProps {
  familyId: string;
  familyName: string;
  todayLabel: string;
  children: CheckInFlowChild[];
  adults: CheckInFlowAdult[];
  activePrograms: CheckInFlowProgram[];
  guardianPinSignin: boolean;
  printNameLabels: boolean;
  printSignoutCode: boolean;
  requiresLogin: boolean;
}

interface CheckedInChild {
  childPersonId: string;
  checkInRecordId: string;
  classId: string | null;
  className: string | null;
  roomName: string | null;
}

interface SkippedChild {
  childPersonId: string;
  reason: "already_checked_in";
}

interface CheckInResult {
  ok: boolean;
  dailyCode: string;
  sessionId: string;
  checkedIn: CheckedInChild[];
  skipped: SkippedChild[];
  /** Set by the service worker when the request was queued offline. */
  queued?: boolean;
  queuedAt?: string;
}

type Method = "guardian_pin" | "kiosk_operator" | "admin" | "teacher";

/**
 * Pick a sensible default class for a child based on age range. Returns null
 * if no class matches or no classes are available.
 */
function pickDefaultClass(
  child: { ageYears: number | null },
  classes: CheckInFlowClass[],
): CheckInFlowClass | null {
  if (classes.length === 0) return null;
  // We don't have ageMin/ageMax on the CheckInFlowClass DTO (left out for
  // brevity) — just default to the first class. The kiosk operator can
  // always change it via the Select.
  return classes[0];
}

export function CheckInFlow({
  familyId,
  familyName,
  todayLabel,
  children: childList,
  adults,
  activePrograms,
  guardianPinSignin,
  printNameLabels,
  printSignoutCode,
  requiresLogin,
}: CheckInFlowProps) {
  const router = useRouter();
  const { t } = useTerminology();

  // ---------------------------------------------------------------
  // Selection state
  // ---------------------------------------------------------------
  // Selected session: programId + (optional) classId per child.
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  // childId → selected
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(
    () => new Set(childList.map((c) => c.id)),
  );
  // childId → classId
  const [classIdByChild, setClassIdByChild] = useState<Record<string, string | null>>({});

  // Guardian identification state.
  const [method, setMethod] = useState<Method>(
    guardianPinSignin ? "guardian_pin" : "kiosk_operator",
  );
  const [pinEntry, setPinEntry] = useState("");
  const [verifiedGuardian, setVerifiedGuardian] = useState<{
    personId: string;
    name: string;
  } | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);

  // Submission state.
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);

  // ---------------------------------------------------------------
  // When the program changes, reset per-child class assignments to the
  // default class for the new program (only for children not already
  // checked in).
  // ---------------------------------------------------------------
  const selectedProgram = useMemo(
    () => activePrograms.find((p) => p.programId === selectedProgramId) ?? null,
    [activePrograms, selectedProgramId],
  );

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    for (const p of activePrograms) {
      const e = p.events.find((ev) => ev.eventId === selectedEventId);
      if (e) return e;
    }
    return null;
  }, [activePrograms, selectedEventId]);

  useEffect(() => {
    if (!selectedProgram) return;
    const next: Record<string, string | null> = {};
    for (const c of childList) {
      if (c.currentlyCheckedIn) {
        // Skip — they're already in.
        next[c.id] = null;
        continue;
      }
      const def = pickDefaultClass(c, selectedProgram.classes);
      next[c.id] = def?.classId ?? null;
    }
    setClassIdByChild(next);
  }, [selectedProgram, childList]);

  // ---------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------
  function toggleChild(id: string) {
    setSelectedChildIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectProgram(programId: string | null) {
    setSelectedProgramId(programId);
    setSelectedEventId(null);
  }
  function selectEvent(eventId: string) {
    setSelectedEventId(eventId);
    setSelectedProgramId(null);
  }
  function setClassForChild(childId: string, classId: string) {
    setClassIdByChild((prev) => ({ ...prev, [childId]: classId }));
  }

  // Children that aren't already checked in (selectable).
  const selectableChildren = childList.filter((c) => !c.currentlyCheckedIn);
  const selectedSelectableChildren = selectableChildren.filter((c) =>
    selectedChildIds.has(c.id),
  );
  const selectedCount = selectedSelectableChildren.length;

  // ---------------------------------------------------------------
  // Guardian PIN verification flow.
  // ---------------------------------------------------------------
  async function verifyPin() {
    if (pinEntry.length < 4) {
      toast.error("Enter a 4–6 digit PIN");
      return;
    }
    setVerifyingPin(true);
    try {
      const res = await fetch("/api/kiosk/guardian-signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, pin: pinEntry }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        personId?: string;
        name?: { firstName: string; lastName: string };
        role?: string;
        error?: string;
        retryAfterMs?: number;
      };
      if (!res.ok || !data.ok) {
        if (res.status === 429) {
          toast.error("Too many attempts", {
            description: "Please wait a minute and try again.",
          });
        } else if (data.error === "pin_signin_disabled") {
          toast.error("PIN sign-in disabled", {
            description: "Use the kiosk-operator check-in instead.",
          });
          setMethod("kiosk_operator");
        } else {
          toast.error("Incorrect PIN", {
            description: "Please try again.",
          });
        }
        return;
      }
      setVerifiedGuardian({
        personId: data.personId!,
        name: `${data.name!.firstName} ${data.name!.lastName}`,
      });
      toast.success("PIN verified", {
        description: `Signed in as ${data.name!.firstName} ${data.name!.lastName}.`,
      });
    } catch (e) {
      console.error("[guardian-signin] error:", e);
      toast.error("Network error — please try again.");
    } finally {
      setVerifyingPin(false);
    }
  }

  function clearPin() {
    setPinEntry("");
    setVerifiedGuardian(null);
  }

  // ---------------------------------------------------------------
  // Submit check-in.
  // ---------------------------------------------------------------
  function validate(): string | null {
    if (!selectedProgramId && !selectedEventId) {
      return "Please pick a session to check in to.";
    }
    if (selectedCount === 0) {
      return "Please select at least one child to check in.";
    }
    if (method === "guardian_pin" && !verifiedGuardian) {
      return "Please verify your PIN before checking in.";
    }
    // For program sessions, each selected child needs a class (unless the
    // program has no classes at all).
    if (selectedProgram && selectedProgram.classes.length > 0) {
      for (const c of selectedSelectableChildren) {
        const cid = classIdByChild[c.id];
        if (!cid) return `Please pick a ${t("group").toLowerCase()} for ${c.firstName} ${c.lastName}.`;
      }
    }
    return null;
  }

  async function submit() {
    const verr = validate();
    if (verr) {
      toast.error("Missing details", { description: verr });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        familyId,
        programId: selectedProgramId,
        eventId: selectedEventId,
        children: selectedSelectableChildren.map((c) => ({
          childPersonId: c.id,
          classId: classIdByChild[c.id] ?? null,
        })),
        checkedInByPersonId:
          method === "guardian_pin" ? verifiedGuardian?.personId ?? null : null,
        method,
      };
      const res = await fetch("/api/kiosk/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as CheckInResult & {
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error("Check-in failed", {
          description: data.error ?? `Request failed (${res.status})` + (data.message ? `: ${data.message}` : ""),
        });
        return;
      }
      setResult(data);
      if (data.queued) {
        toast.success("Queued — will sync when reconnected", {
          description:
            "Your check-in was saved locally. The daily code will be generated once the kiosk is back online.",
        });
        return;
      }
      const skippedMsg =
        data.skipped.length > 0
          ? ` ${data.skipped.length} already checked in (skipped).`
          : "";
      toast.success("Checked in!", {
        description: `Daily code: ${data.dailyCode}${skippedMsg}`,
      });
    } catch (e) {
      console.error("[checkin] error:", e);
      toast.error("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------
  // Print: dispatch via the printing library (Stage 11).
  // The server returns one of:
  //   - { method: "browser", html }        → open hidden iframe + print
  //   - { method: "qz_tray", payload }     → forward to local QZ Tray
  //   - { method: "thermal_raw", commands } → ESC/POS raw via QZ Tray RAW
  // ---------------------------------------------------------------
  async function printLabels() {
    if (!result) return;
    try {
      const outcomes = await Promise.all(
        result.checkedIn.map(async (c) => {
          const res = await fetch("/api/kiosk/print/label", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checkInRecordId: c.checkInRecordId }),
          });
          if (!res.ok) {
            throw new Error(`label print failed (${res.status})`);
          }
          const data = (await res.json()) as PrintResult;
          return executePrint(data);
        }),
      );
      const failed = outcomes.find((o) => !o.ok);
      if (failed) {
        toast.error("Print failed", { description: failed.message });
      } else {
        const first = outcomes[0];
        toast.success("Sent to printer", {
          description: `${result.checkedIn.length} label(s) · ${first?.message ?? "ok"}`,
        });
      }
    } catch (e) {
      toast.error("Print failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }
  async function printSlip() {
    if (!result) return;
    try {
      const res = await fetch("/api/kiosk/print/slip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId }),
      });
      if (!res.ok) {
        throw new Error(`slip print failed (${res.status})`);
      }
      const data = (await res.json()) as PrintResult;
      const outcome = await executePrint(data);
      if (!outcome.ok) {
        toast.error("Print failed", { description: outcome.message });
      } else {
        toast.success("Sent to printer", { description: outcome.message });
      }
    } catch (e) {
      toast.error("Print failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  // ---------------------------------------------------------------
  // SUCCESS SCREEN
  // ---------------------------------------------------------------
  if (result?.queued) {
    // Offline-queued check-in: synthetic success from the service worker.
    // No daily code yet — it will be generated server-side when the queue
    // replays on reconnect.
    return (
      <div className="flex-1 flex flex-col">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 flex-1 flex flex-col gap-6">
          <div className="text-center space-y-2">
            <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <CloudUpload className="h-9 w-9" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Queued</h1>
            <p className="text-sm text-muted-foreground">
              You&apos;re offline. Your check-in was saved on this kiosk and will
              sync automatically when reconnected.
            </p>
          </div>

          <Card className="border-2 border-amber-400/60 bg-amber-50 dark:bg-amber-950/30">
            <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Today&apos;s signout code
              </span>
              <span
                className="font-mono font-bold tabular-nums text-amber-700 dark:text-amber-300 leading-none"
                style={{ fontSize: "4rem", letterSpacing: "0.05em" }}
              >
                ···
              </span>
              <p className="text-sm text-muted-foreground max-w-sm">
                Your daily code will be generated once the kiosk is back online
                and the queued check-in has synced.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("child_plural")} queued for check-in
              </CardTitle>
              <CardDescription className="text-xs">
                {selectedSelectableChildren.length} queued
                {" · "}
                {todayLabel}
                {result.queuedAt ? ` · queued ${new Date(result.queuedAt).toLocaleTimeString()}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {selectedSelectableChildren.map((c) => {
                const cls = selectedProgram?.classes.find(
                  (cl) => cl.classId === (classIdByChild[c.id] ?? null),
                );
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Baby className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="font-medium truncate">
                        {c.firstName} {c.lastName}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {cls?.className ?? "—"}
                      {cls?.roomName ? ` · ${cls.roomName}` : ""}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Button
            className="h-16 text-base w-full"
            size="lg"
            onClick={() => router.push(`/kiosk/family/${familyId}`)}
          >
            Done — back to family
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-12">
            <Link href="/kiosk">Back to search</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 flex-1 flex flex-col gap-6">
          <div className="text-center space-y-2">
            <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Checked in!</h1>
            <p className="text-sm text-muted-foreground">
              Show this code to anyone picking up your {t("child_plural").toLowerCase()} today —
              they can use it for fast sign-out.
            </p>
          </div>

          <Card className="border-2 border-primary/40">
            <CardContent className="py-8 flex flex-col items-center gap-3">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Today&apos;s signout code
              </span>
              <span
                className="font-mono font-bold tabular-nums text-primary leading-none"
                style={{ fontSize: "8rem", letterSpacing: "0.05em" }}
                aria-label={`Daily code ${result.dailyCode}`}
              >
                {result.dailyCode}
              </span>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Camera className="h-3.5 w-3.5" />
                <span>Take a photo of this code or write it down.</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("child_plural")} checked in
              </CardTitle>
              <CardDescription className="text-xs">
                {result.checkedIn.length} checked in
                {result.skipped.length > 0 ? ` · ${result.skipped.length} already in (skipped)` : ""}
                {" · "}
                {todayLabel}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {result.checkedIn.map((c) => {
                const child = childList.find((cl) => cl.id === c.childPersonId);
                return (
                  <div
                    key={c.childPersonId}
                    className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Baby className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium truncate">
                        {child ? `${child.firstName} ${child.lastName}` : c.childPersonId}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {c.className ?? "—"}
                      {c.roomName ? ` · ${c.roomName}` : ""}
                    </span>
                  </div>
                );
              })}
              {result.skipped.length > 0 && (
                <p className="text-xs text-muted-foreground px-1 pt-1">
                  {result.skipped.length} {t("child").toLowerCase()}{result.skipped.length === 1 ? "" : t("child_plural").toLowerCase()} already checked in to this session — not duplicated.
                </p>
              )}
            </CardContent>
          </Card>

          {printNameLabels && (
            <Button
              variant="outline"
              className="h-14 text-base w-full"
              size="lg"
              onClick={printLabels}
            >
              <Printer className="mr-2 h-5 w-5" /> Print name labels
            </Button>
          )}
          {printSignoutCode && (
            <Button
              variant="outline"
              className="h-14 text-base w-full"
              size="lg"
              onClick={printSlip}
            >
              <Printer className="mr-2 h-5 w-5" /> Print signout code slip
            </Button>
          )}

          <Button
            className="h-16 text-base w-full"
            size="lg"
            onClick={() => router.push(`/kiosk/family/${familyId}`)}
          >
            Done — back to family
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-12"
          >
            <Link href="/kiosk">Back to search</Link>
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // CHECK-IN FORM SCREEN
  // ---------------------------------------------------------------
  const hasPrograms = activePrograms.length > 0;

  const sessionLabel = selectedProgram
    ? selectedProgram.programName
    : selectedEvent
      ? selectedEvent.eventName
      : null;

  return (
    <div className="flex-1 flex flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 flex-1 flex flex-col gap-5 pb-28">
        <div>
          <Button asChild variant="ghost" size="sm" className="h-12 -ml-2 text-muted-foreground">
            <Link href={`/kiosk/family/${familyId}`}>
              <ArrowLeft className="mr-1.5 h-5 w-5" /> Back to {familyName}
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <CalendarClock className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight truncate">
              Check in — {familyName}
            </h1>
            <p className="text-sm text-muted-foreground">{todayLabel}</p>
          </div>
        </div>

        {/* Session selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" /> 1. Pick a session
            </CardTitle>
            <CardDescription className="text-xs">
              Today&apos;s active programs and events.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {!hasPrograms && (
              <p className="text-sm text-muted-foreground">
                No scheduled sessions today. Ask a coordinator to create an Event if you need to check in.
              </p>
            )}
            {activePrograms.map((p) => {
              const isStandalone = p.programId === null;
              const isSelected = !isStandalone && selectedProgramId === p.programId;
              const hasEventsSelected =
                isStandalone && selectedEventId !== null &&
                p.events.some((e) => e.eventId === selectedEventId);
              return (
                <div key={p.programId ?? "standalone"}>
                  <button
                    type="button"
                    onClick={() => !isStandalone && selectProgram(p.programId)}
                    disabled={isStandalone || (p.programId !== null && p.classes.length === 0)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors disabled:cursor-default ${
                      isSelected
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : hasEventsSelected
                          ? "border-primary/50 bg-primary/5"
                          : isStandalone
                            ? "border-dashed border-border bg-muted/30 cursor-default"
                            : "border-border bg-card hover:bg-accent/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{p.programName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isStandalone
                            ? `${p.events.length} event${p.events.length === 1 ? "" : "s"}`
                            : p.firstScheduleTime
                              ? `${p.classes.length} ${t("group_plural").toLowerCase()} · ${p.firstScheduleTime}`
                              : `${p.classes.length} ${t("group_plural").toLowerCase()}`}
                        </p>
                      </div>
                      {isSelected && <Badge variant="default">Selected</Badge>}
                    </div>
                  </button>
                  {p.events.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-1">
                      <span className="text-[11px] text-muted-foreground self-center">Events:</span>
                      {p.events.map((e) => {
                        const sel = selectedEventId === e.eventId;
                        return (
                          <button
                            key={e.eventId}
                            type="button"
                            onClick={() => selectEvent(e.eventId)}
                            className={`text-xs rounded-md border px-2 py-1 transition-colors ${
                              sel
                                ? "border-primary bg-primary/10"
                                : "border-border bg-background hover:bg-accent/40"
                            }`}
                          >
                            {e.eventName}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Children selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Baby className="h-4 w-4 text-primary" /> 2. Select {t("child_plural").toLowerCase()} + {t("group_plural").toLowerCase()}
            </CardTitle>
            <CardDescription className="text-xs">
              Tick the {t("child_plural").toLowerCase()} checking in to <strong>{sessionLabel ?? "—"}</strong>.
              Allergies + medical notes are shown here for safety.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {childList.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No {t("child_plural").toLowerCase()} on this family.
              </p>
            )}
            {childList.map((c) => {
              const isSelectable = !c.currentlyCheckedIn;
              const isSelected = selectedChildIds.has(c.id);
              const hasAllergies = !!c.allergies && c.allergies.trim().length > 0;
              const hasMedical = !!c.medicalNotes && c.medicalNotes.trim().length > 0;
              const hasAlert = hasAllergies || hasMedical;
              return (
                <div
                  key={c.id}
                  className={`rounded-xl border p-3 space-y-3 ${
                    hasAlert ? "border-destructive/40 bg-destructive/5" : "bg-card"
                  } ${!isSelectable ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`chk-${c.id}`}
                      checked={isSelected}
                      onCheckedChange={() => isSelectable && toggleChild(c.id)}
                      disabled={!isSelectable}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <label
                          htmlFor={`chk-${c.id}`}
                          className={`font-medium ${isSelectable ? "cursor-pointer" : ""}`}
                        >
                          {c.firstName} {c.lastName}
                        </label>
                        {c.ageYears !== null && (
                          <Badge variant="secondary" className="text-[10px]">
                            {c.ageYears} yrs
                          </Badge>
                        )}
                        {c.schoolGrade && (
                          <Badge variant="outline" className="text-[10px]">
                            {c.schoolGrade}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isSelectable ? "" : ""}
                      </p>
                    </div>
                    {c.currentlyCheckedIn ? (
                      <Badge variant="default" className="gap-1 shrink-0 bg-emerald-600 hover:bg-emerald-600">
                        <CheckCircle2 className="h-3 w-3" /> Already checked in ✓
                      </Badge>
                    ) : hasAlert ? (
                      <Badge variant="destructive" className="gap-1 shrink-0">
                        <AlertTriangle className="h-3 w-3" /> Alert
                      </Badge>
                    ) : null}
                  </div>

                  {/* Allergy / medical alerts — UNMISSABLE */}
                  {hasAlert && (
                    <div className="space-y-1.5">
                      {hasAllergies && (
                        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold">Allergy: {c.allergies}</p>
                          </div>
                        </div>
                      )}
                      {hasMedical && (
                        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive flex items-start gap-2">
                          <HeartPulse className="h-4 w-4 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold">Medical: {c.medicalNotes}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Class assignment — only when this program has classes and child is selectable + selected */}
                  {isSelectable && isSelected && selectedProgram && selectedProgram.classes.length > 0 && (
                    <div className="flex items-center gap-3 pt-1">
                      <Label htmlFor={`class-${c.id}`} className="text-xs text-muted-foreground shrink-0">
                        {t("group")}:
                      </Label>
                      <Select
                        value={classIdByChild[c.id] ?? ""}
                        onValueChange={(v) => setClassForChild(c.id, v)}
                      >
                        <SelectTrigger id={`class-${c.id}`} className="h-11 flex-1">
                          <SelectValue placeholder={`Pick a ${t("group").toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedProgram.classes.map((cls) => (
                            <SelectItem key={cls.classId} value={cls.classId}>
                              {cls.className}
                              {cls.roomName ? ` · ${cls.roomName}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Guardian identification */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" /> 3. Identify yourself
            </CardTitle>
            <CardDescription className="text-xs">
              Who is performing this check-in?
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {guardianPinSignin && (
              <div className="space-y-2">
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="method"
                    className="mt-1"
                    checked={method === "guardian_pin"}
                    onChange={() => setMethod("guardian_pin")}
                  />
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">
                        Sign in as guardian (PIN)
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Verify with your 4–6 digit PIN. The check-in will be
                      attributed to you.
                    </p>
                    {method === "guardian_pin" && (
                      <div className="pt-2 space-y-2">
                        {verifiedGuardian ? (
                          <div className="rounded-md border bg-emerald-50 dark:bg-emerald-950/40 p-2.5 text-sm flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 min-w-0">
                              <CheckCircle2 className="h-4 w-4 shrink-0" />
                              <span className="truncate">
                                Verified: <strong>{verifiedGuardian.name}</strong>
                              </span>
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={clearPin}
                            >
                              Change
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex gap-2">
                              <Input
                                type="password"
                                inputMode="numeric"
                                autoComplete="off"
                                placeholder="Enter PIN"
                                value={pinEntry}
                                onChange={(e) => setPinEntry(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                className="h-12 text-lg font-mono tracking-widest"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") verifyPin();
                                }}
                              />
                              <Button
                                type="button"
                                className="h-12 px-4"
                                onClick={verifyPin}
                                disabled={verifyingPin || pinEntry.length < 4}
                              >
                                {verifyingPin ? (
                                  <Loader2 className="h-5 w-5 animate-spin" />
                                ) : (
                                  "Verify"
                                )}
                              </Button>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Tip: ask an admin to set your PIN if you don&apos;t have one yet.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="method"
                    className="mt-1"
                    checked={method === "kiosk_operator"}
                    onChange={() => {
                      setMethod("kiosk_operator");
                      clearPin();
                    }}
                  />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        Check in as kiosk operator
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {requiresLogin
                        ? "Attributed to the signed-in kiosk operator."
                        : "Attributed to the kiosk (no PIN)."}
                    </p>
                  </div>
                </label>
              </div>
            )}

            {!guardianPinSignin && (
              <div className="rounded-md bg-muted/30 p-3 text-sm text-muted-foreground flex items-start gap-2">
                <Lock className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  Guardian PIN sign-in is disabled by your administrators. This
                  check-in will be attributed to the kiosk operator.
                  {requiresLogin ? "" : " (Open kiosk — no login required.)"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sticky submit footer */}
      <div className="sticky bottom-0 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-12">
            <Link href={`/kiosk/family/${familyId}`}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Cancel
            </Link>
          </Button>
          <Button
            className="flex-1 h-16 text-base"
            size="lg"
            disabled={
              submitting ||
              selectedCount === 0 ||
              (!selectedProgramId && !selectedEventId) ||
              (method === "guardian_pin" && !verifiedGuardian)
            }
            onClick={submit}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking in…
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-5 w-5" />
                Check in {selectedCount} {selectedCount === 1 ? t("child") : t("child_plural")}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
