"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  UserPlus,
  Loader2,
  Baby,
  Plus,
  Trash2,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  Printer,
  Camera,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTerminology } from "@/hooks/use-terminology";
import { executePrint } from "@/lib/print-client";
import type { PrintResult } from "@/lib/printing";

export interface VisitorSessionOption {
  programId: string | null;
  programName: string;
  slug: string | null;
  classCount: number;
  firstScheduleTime: string | null;
  eventCount: number;
  events: { eventId: string; eventName: string }[];
}

export interface VisitorCheckInFlowProps {
  todayLabel: string;
  activePrograms: VisitorSessionOption[];
  visitorsAddToDbFlag: boolean;
  requiresLogin: boolean;
}

interface VisitorChild {
  id: string; // local-only id
  firstName: string;
  lastName: string;
  dateOfBirth: string; // yyyy-mm-dd from <input type="date">
  allergies: string;
  medicalNotes: string;
}

interface CheckedInChild {
  childPersonId: string;
  checkInRecordId: string;
  childName: string;
  className: string | null;
  roomName: string | null;
}

let childIdCounter = 0;
function newChildId(): string {
  childIdCounter += 1;
  return `local-${childIdCounter}`;
}

export function VisitorCheckInFlow({
  todayLabel,
  activePrograms,
  visitorsAddToDbFlag,
  requiresLogin,
}: VisitorCheckInFlowProps) {
  const router = useRouter();
  const { t } = useTerminology();

  // Guardian fields.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  // Children.
  const [children, setChildren] = useState<VisitorChild[]>([
    { id: newChildId(), firstName: "", lastName: "", dateOfBirth: "", allergies: "", medicalNotes: "" },
  ]);

  // Session selection.
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Add-to-DB checkbox.
  const [addToDatabase, setAddToDatabase] = useState<boolean>(true);

  // Submission state.
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    dailyCode: string;
    checkedIn: CheckedInChild[];
    familyId: string;
    visitorKept: boolean;
  } | null>(null);

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  function addChild() {
    setChildren((cs) => [
      ...cs,
      { id: newChildId(), firstName: "", lastName: "", dateOfBirth: "", allergies: "", medicalNotes: "" },
    ]);
  }
  function removeChild(id: string) {
    setChildren((cs) => (cs.length === 1 ? cs : cs.filter((c) => c.id !== id)));
  }
  function patchChild(id: string, patch: Partial<VisitorChild>) {
    setChildren((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function selectSession(programId: string | null, eventId: string | null) {
    setSelectedProgramId(programId);
    setSelectedEventId(eventId);
  }

  // ---------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------
  function validate(): string | null {
    if (!firstName.trim()) return "Please enter your first name.";
    if (!lastName.trim()) return "Please enter your last name.";
    if (children.length === 0) return "Please add at least one child.";
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (!c.firstName.trim() || !c.lastName.trim()) {
        return `Child ${i + 1}: please enter first and last name.`;
      }
    }
    if (!selectedProgramId && !selectedEventId) {
      return "Please pick a session to check in to.";
    }
    return null;
  }

  // ---------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------
  async function submit() {
    const verr = validate();
    if (verr) {
      toast.error("Missing details", { description: verr });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || null,
        children: children.map((c) => ({
          firstName: c.firstName.trim(),
          lastName: c.lastName.trim(),
          dateOfBirth: c.dateOfBirth
            ? new Date(c.dateOfBirth + "T00:00:00.000Z").toISOString()
            : null,
          allergies: c.allergies.trim() || null,
          medicalNotes: c.medicalNotes.trim() || null,
        })),
        programId: selectedProgramId,
        eventId: selectedEventId,
        addToDatabase,
      };
      const res = await fetch("/api/kiosk/visitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        dailyCode?: string;
        checkedIn?: CheckedInChild[];
        familyId?: string;
        visitorKept?: boolean;
      };
      if (!res.ok || !data.ok) {
        const msg = data.error ?? `Request failed (${res.status})`;
        toast.error("Check-in failed", { description: msg + (data.message ? `: ${data.message}` : "") });
        return;
      }
      setResult({
        dailyCode: data.dailyCode ?? "???",
        checkedIn: data.checkedIn ?? [],
        familyId: data.familyId ?? "",
        visitorKept: data.visitorKept ?? false,
      });
      toast.success("Checked in!", {
        description: `Daily code: ${data.dailyCode}`,
      });
    } catch (e) {
      console.error("[visitor-checkin] error:", e);
      toast.error("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------
  // Print: dispatch via the printing library (Stage 11).
  // Server returns browser / qz_tray / thermal_raw payload; the client
  // transports each appropriately (browser = hidden iframe + print()).
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
    if (!result || !result.familyId) return;
    try {
      const res = await fetch("/api/kiosk/print/slip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId: result.familyId }),
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
  // Success screen
  // ---------------------------------------------------------------
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
              Show this code to any carer or guardian of your family signing
              in later — they can use it to quickly sign out.
            </p>
          </div>

          {/* Huge daily code */}
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

          {/* Children list */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("child_plural")} checked in</CardTitle>
              <CardDescription className="text-xs">
                {result.checkedIn.length} {result.checkedIn.length === 1 ? t("child") : t("child_plural")} · {todayLabel}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {result.checkedIn.map((c) => (
                <div
                  key={c.childPersonId}
                  className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Baby className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-medium truncate">{c.childName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {c.className ?? "—"}
                    {c.roomName ? ` · ${c.roomName}` : ""}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {!result.visitorKept && (
            <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                This visitor family will NOT be added to the regular database.
                You&apos;ll need to check in again next time. Ask a coordinator
                if you&apos;d like your family saved permanently.
              </p>
            </div>
          )}

          {/* Print buttons */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-14 text-base"
              size="lg"
              onClick={printLabels}
            >
              <Printer className="mr-2 h-5 w-5" /> Print name labels
            </Button>
            <Button
              variant="outline"
              className="h-14 text-base"
              size="lg"
              onClick={printSlip}
            >
              <Printer className="mr-2 h-5 w-5" /> Print signout slip
            </Button>
          </div>

          {/* Done */}
          <Button
            className="h-16 text-base w-full"
            size="lg"
            onClick={() => router.push("/kiosk")}
          >
            Done — back to search
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Form screen
  // ---------------------------------------------------------------
  const hasPrograms = activePrograms.length > 0;

  return (
    <div className="flex-1 flex flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 flex-1 flex flex-col gap-5">
        <div>
          <Button asChild variant="ghost" size="sm" className="h-12 -ml-2 text-muted-foreground">
            <Link href="/kiosk">
              <ArrowLeft className="mr-1.5 h-5 w-5" /> Back to search
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <UserPlus className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">Visitor check-in</h1>
            <p className="text-sm text-muted-foreground">
              New here? Add yourself + your {t("child_plural").toLowerCase()} and check in for today.
            </p>
          </div>
        </div>

        {/* Guardian details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your details (guardian)</CardTitle>
            <CardDescription className="text-xs">
              We&apos;ll use these to set up a temporary family record for today.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="g-first">First name</Label>
                <Input
                  id="g-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="h-12 text-base"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-last">Last name</Label>
                <Input
                  id="g-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="h-12 text-base"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-phone">Phone (optional)</Label>
              <Input
                id="g-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                className="h-12 text-base"
                autoComplete="off"
              />
            </div>
          </CardContent>
        </Card>

        {/* Children */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">{t("child_plural")}</CardTitle>
              <CardDescription className="text-xs">
                Add each child checking in today.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={addChild} className="h-10">
              <Plus className="mr-1 h-4 w-4" /> Add child
            </Button>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {children.map((c, idx) => {
              const hasAlert =
                (c.allergies && c.allergies.trim().length > 0) ||
                (c.medicalNotes && c.medicalNotes.trim().length > 0);
              return (
                <div key={c.id} className="rounded-xl border p-3 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("child")} {idx + 1}
                    </span>
                    {children.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeChild(c.id)}
                        className="h-8 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`c-first-${c.id}`}>First name</Label>
                      <Input
                        id={`c-first-${c.id}`}
                        value={c.firstName}
                        onChange={(e) => patchChild(c.id, { firstName: e.target.value })}
                        className="h-12 text-base"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`c-last-${c.id}`}>Last name</Label>
                      <Input
                        id={`c-last-${c.id}`}
                        value={c.lastName}
                        onChange={(e) => patchChild(c.id, { lastName: e.target.value })}
                        className="h-12 text-base"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`c-dob-${c.id}`}>Date of birth (optional)</Label>
                    <Input
                      id={`c-dob-${c.id}`}
                      type="date"
                      value={c.dateOfBirth}
                      onChange={(e) => patchChild(c.id, { dateOfBirth: e.target.value })}
                      className="h-12 text-base"
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`c-allergy-${c.id}`}>Allergies (optional)</Label>
                      <Input
                        id={`c-allergy-${c.id}`}
                        value={c.allergies}
                        onChange={(e) => patchChild(c.id, { allergies: e.target.value })}
                        className="h-12 text-base"
                        placeholder="e.g. Peanuts"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`c-medical-${c.id}`}>Medical notes (optional)</Label>
                      <Input
                        id={`c-medical-${c.id}`}
                        value={c.medicalNotes}
                        onChange={(e) => patchChild(c.id, { medicalNotes: e.target.value })}
                        className="h-12 text-base"
                        placeholder="e.g. Asthma"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  {hasAlert && (
                    <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>Alerts will be highlighted on the check-in summary.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Session selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" /> Check-in session
            </CardTitle>
            <CardDescription className="text-xs">{todayLabel}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {!hasPrograms && (
              <p className="text-sm text-muted-foreground">
                No scheduled sessions today. Ask a coordinator to create an Event
                if you need to check in.
              </p>
            )}
            {activePrograms.map((p) => {
              const isStandalone = p.programId === null;
              const isSelected = !isStandalone && selectedProgramId === p.programId;
              const hasEventsSelected =
                isStandalone &&
                selectedEventId !== null &&
                p.events.some((e) => e.eventId === selectedEventId);
              return (
                <div key={p.programId ?? "standalone"}>
                  <button
                    key={p.programId ?? "standalone"}
                    type="button"
                    onClick={() => !isStandalone && selectSession(p.programId, null)}
                    disabled={isStandalone}
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
                            ? `${p.eventCount} event${p.eventCount === 1 ? "" : "s"}`
                            : p.firstScheduleTime
                              ? `${p.classCount} ${t("group_plural").toLowerCase()} · ${p.firstScheduleTime}`
                              : `${p.classCount} ${t("group_plural").toLowerCase()}`}
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
                            onClick={() => selectSession(null, e.eventId)}
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

        {/* Add to DB checkbox */}
        {visitorsAddToDbFlag && (
          <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 cursor-pointer">
            <Checkbox
              id="add-to-db"
              checked={addToDatabase}
              onCheckedChange={(v) => setAddToDatabase(v === true)}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label htmlFor="add-to-db" className="text-sm font-medium cursor-pointer">
                Add our family to the regular database for future visits
              </Label>
              <p className="text-xs text-muted-foreground">
                If checked, your family will be saved permanently so you can
                search for it next time. Otherwise, this is a one-time visitor record.
              </p>
            </div>
          </label>
        )}

        {/* Sticky action footer */}
        <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background/95 backdrop-blur border-t flex items-center gap-3">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-12"
          >
            <Link href="/kiosk">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Cancel
            </Link>
          </Button>
          <Button
            className="flex-1 h-16 text-base"
            size="lg"
            disabled={submitting || (!selectedProgramId && !selectedEventId)}
            onClick={submit}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking in…
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-5 w-5" />
                Check in {children.length} {children.length === 1 ? t("child") : t("child_plural")}
              </>
            )}
          </Button>
        </div>
        {requiresLogin && (
          <p className="text-xs text-muted-foreground text-center -mt-2">
            Kiosk is locked — your check-in will be attributed to the kiosk operator on duty.
          </p>
        )}
      </div>
    </div>
  );
}
