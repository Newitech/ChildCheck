"use client";

import { useEffect, useState } from "react";
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
  CheckCircle2,
  KeyRound,
  Lock,
  Delete,
  Search,
  UserCheck,
  Camera,
  ShieldAlert,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTerminology } from "@/hooks/use-terminology";

// ---------------------------------------------------------------------------
// Types — mirror the server-side DTOs in ./page.tsx
// ---------------------------------------------------------------------------

export interface CheckoutFlowChild {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  ageYears: number | null;
  schoolGrade: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  hasPhoto: boolean;
  checkInRecordId: string | null;
  checkedOutAt: string | null;
  checkoutMethod: string | null;
  className: string | null;
  roomName: string | null;
}

export interface CheckoutFlowAdult {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  hasPhoto: boolean;
}

export interface CheckoutFlowProps {
  familyId: string;
  familyName: string;
  todayLabel: string;
  children: CheckoutFlowChild[];
  adults: CheckoutFlowAdult[];
  guardianPinSignin: boolean;
  overrideCheckout: boolean;
  photoVerification: boolean;
  isStaff: boolean;
  staffName: string | null;
  dailyCodeLength: number;
  dailyCodeCharset: "alphanumeric" | "numeric";
}

type Method = "code" | "pin" | "override";

interface BlockedChild {
  childPersonId: string;
  reason: "blacklisted" | "flagged_requires_override" | "not_authorised";
  blacklistEntryId?: string;
  blacklistReason?: string;
  severity?: string;
}
interface CheckedOutChild {
  childPersonId: string;
  checkInRecordId: string;
  method: string;
  collectorPersonId: string | null;
}
interface SkippedChild {
  childPersonId: string;
  reason: "already_checked_out";
}
interface CheckoutResult {
  ok: boolean;
  checkedOut: CheckedOutChild[];
  skipped: SkippedChild[];
  blocked: BlockedChild[];
  /** Set by the service worker when the request was queued offline. */
  queued?: boolean;
  queuedAt?: string;
}

interface PersonSearchHit {
  id: string;
  firstName: string;
  lastName: string;
  personType: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CheckoutFlow({
  familyId,
  familyName,
  todayLabel,
  children: childList,
  adults,
  guardianPinSignin,
  overrideCheckout,
  photoVerification,
  isStaff,
  staffName,
  dailyCodeLength,
  dailyCodeCharset,
}: CheckoutFlowProps) {
  const router = useRouter();
  const { t } = useTerminology();

  // Default method: code if available, otherwise PIN, otherwise override.
  const defaultMethod: Method = overrideCheckout && isStaff ? "override" : guardianPinSignin ? "pin" : "code";
  const [method, setMethod] = useState<Method>(defaultMethod);

  // Children selection — default to all currently-checked-in (not yet
  // checked-out) children selected.
  const initiallyCheckedIn = childList.filter((c) => c.checkInRecordId && !c.checkedOutAt);
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(
    () => new Set(initiallyCheckedIn.map((c) => c.id)),
  );

  // Photo-verification checkbox state.
  const [photoVerified, setPhotoVerified] = useState(false);

  // PIN method state.
  const [pinEntry, setPinEntry] = useState("");
  const [verifiedGuardian, setVerifiedGuardian] = useState<{
    personId: string;
    name: string;
  } | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);

  // Override method state.
  const [overrideCollectorMode, setOverrideCollectorMode] = useState<"person" | "freetext">(
    "person",
  );
  const [collectorPersonId, setCollectorPersonId] = useState<string | null>(null);
  const [collectorSearchQuery, setCollectorSearchQuery] = useState("");
  const [collectorSearchHits, setCollectorSearchHits] = useState<PersonSearchHit[]>([]);
  const [collectorSearchLoading, setCollectorSearchLoading] = useState(false);
  const [collectorName, setCollectorName] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);

  // Submission state.
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);

  // ---------------------------------------------------------------
  // Refs / effects
  // ---------------------------------------------------------------
  // Reset photo-verified when method changes or selection changes.
  useEffect(() => {
    setPhotoVerified(false);
  }, [method, selectedChildIds]);

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

  // Children that are currently checked in AND not yet checked out.
  const checkedInChildren = childList.filter((c) => c.checkInRecordId && !c.checkedOutAt);
  const checkedOutChildren = childList.filter((c) => c.checkedOutAt);

  const selectedChildren = checkedInChildren.filter((c) => selectedChildIds.has(c.id));
  const selectedCount = selectedChildren.length;

  // ---------------------------------------------------------------
  // Guardian PIN verification flow (re-uses /api/kiosk/guardian-signin).
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
          toast.error("PIN sign-in disabled");
          setMethod("code");
        } else {
          toast.error("Incorrect PIN", { description: "Please try again." });
        }
        return;
      }
      setVerifiedGuardian({
        personId: data.personId!,
        name: `${data.name!.firstName} ${data.name!.lastName}`,
      });
      setCollectorPersonId(data.personId!);
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
    setCollectorPersonId(null);
  }

  function pressPin(d: string) {
    setPinEntry((p) => (p.length >= 8 ? p : p + d));
  }
  function backspacePin() {
    setPinEntry((p) => p.slice(0, -1));
  }

  // ---------------------------------------------------------------
  // Collector search for the override method (Admin/Teacher can search
  // any Person in the DB to identify the collector).
  // ---------------------------------------------------------------
  useEffect(() => {
    if (method !== "override" || overrideCollectorMode !== "person") return;
    const q = collectorSearchQuery.trim();
    if (q.length < 2) {
      setCollectorSearchHits([]);
      return;
    }
    setCollectorSearchLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/people?q=${encodeURIComponent(q)}&pageSize=10`,
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          setCollectorSearchHits([]);
          return;
        }
        const data = (await res.json()) as { items: PersonSearchHit[] };
        setCollectorSearchHits(data.items);
      } catch {
        // ignore — likely aborted
      } finally {
        setCollectorSearchLoading(false);
      }
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [method, overrideCollectorMode, collectorSearchQuery]);

  // ---------------------------------------------------------------
  // Submit check-out.
  // ---------------------------------------------------------------
  function validate(): string | null {
    if (selectedCount === 0) {
      return `Please select at least one ${t("child").toLowerCase()} to check out.`;
    }
    if (method === "code") {
      if (codeEntry.trim().length === 0) return "Enter the daily code.";
    }
    if (method === "pin") {
      if (!verifiedGuardian) return "Verify your PIN before checking out.";
    }
    if (method === "override") {
      if (!overrideConfirmed)
        return "You must tick the confirmation checkbox to override.";
      if (overrideNote.trim().length < 10)
        return "Override note must be at least 10 characters.";
      if (overrideCollectorMode === "person" && !collectorPersonId)
        return "Pick a collector from the search results (or switch to free-text name).";
      if (overrideCollectorMode === "freetext" && collectorName.trim().length < 2)
        return "Enter the collector's name.";
    }
    if (photoVerification && !photoVerified) {
      return "Please tick the photo verification checkbox.";
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
      const payload: Record<string, unknown> = {
        familyId,
        childPersonIds: selectedChildren.map((c) => c.id),
        method,
        photoVerified: photoVerification ? photoVerified : null,
      };
      if (method === "code") {
        payload.code = codeEntry.trim();
      }
      if (method === "pin") {
        payload.collectorPersonId = verifiedGuardian?.personId ?? null;
      }
      if (method === "override") {
        payload.collectorPersonId =
          overrideCollectorMode === "person" ? collectorPersonId : null;
        payload.collectorName =
          overrideCollectorMode === "freetext" ? collectorName.trim() : null;
        payload.overrideNote = overrideNote.trim();
        payload.overrideConfirmed = overrideConfirmed;
      }
      const res = await fetch("/api/kiosk/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as CheckoutResult & {
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        if (data.error === "invalid_code") {
          toast.error("Wrong code", {
            description: "The code you entered does not match today's code for this family.",
          });
        } else if (data.error === "rate_limited") {
          toast.error("Too many attempts", {
            description: "Please wait a minute and try again.",
          });
        } else if (data.error === "photo_verification_required") {
          toast.error("Photo verification required", {
            description: "Tick the photo verification checkbox first.",
          });
        } else if (data.error === "override_note_required") {
          toast.error("Override note too short", {
            description: "Please enter at least 10 characters explaining the override.",
          });
        } else if (data.error === "override_confirmation_required") {
          toast.error("Confirmation required", {
            description: "You must tick the confirmation checkbox to override.",
          });
        } else if (data.error === "override_disabled") {
          toast.error("Override disabled", {
            description: "An admin must enable the override_checkout flag.",
          });
        } else if (data.error === "unauthorized") {
          toast.error("Sign in required", {
            description: "Sign in as Admin / Teacher / Security to use override.",
          });
        } else if (data.error === "forbidden") {
          toast.error("Not authorised", { description: data.message ?? "" });
        } else {
          toast.error("Check-out failed", {
            description: data.error ?? `Request failed (${res.status})`,
          });
        }
        return;
      }
      setResult(data);
      if (data.queued) {
        toast.success("Queued — will sync when reconnected", {
          description:
            "Your check-out was saved locally and will be applied once the kiosk is back online.",
        });
        return;
      }
      if (data.blocked.length > 0) {
        toast.error(`${data.blocked.length} child(ren) blocked`, {
          description: "See the alert below — security has been alerted.",
        });
      } else {
        const skipMsg =
          data.skipped.length > 0
            ? ` · ${data.skipped.length} already checked out`
            : "";
        toast.success("Checked out!", {
          description: `${data.checkedOut.length} ${
            data.checkedOut.length === 1
              ? t("child").toLowerCase()
              : t("child_plural").toLowerCase()
          } signed out${skipMsg}.`,
        });
      }
    } catch (e) {
      console.error("[checkout] error:", e);
      toast.error("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------
  // Code input state
  // ---------------------------------------------------------------
  const [codeEntry, setCodeEntry] = useState("");

  // Auto-uppercase + filter for the code input.
  function onCodeChange(v: string) {
    const charset =
      dailyCodeCharset === "numeric"
        ? /[^0-9]/g
        : /[^A-Za-z0-9]/g;
    setCodeEntry(v.toUpperCase().replace(charset, "").slice(0, dailyCodeLength));
  }

  // ---------------------------------------------------------------
  // SUCCESS SCREEN (with optional blocked alert)
  // ---------------------------------------------------------------
  if (result?.queued) {
    // Offline-queued check-out: synthetic success from the service worker.
    // The actual check-out records will be created when the queue replays.
    return (
      <div className="flex-1 flex flex-col">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 flex-1 flex flex-col gap-6 pb-28">
          <div className="text-center space-y-2">
            <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <CloudUpload className="h-9 w-9" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Queued</h1>
            <p className="text-sm text-muted-foreground">
              You&apos;re offline. Your check-out was saved on this kiosk and will
              sync automatically when reconnected.
            </p>
          </div>

          <Card className="border-2 border-amber-400/60 bg-amber-50 dark:bg-amber-950/30">
            <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground max-w-sm">
                {selectedChildren.length} {selectedChildren.length === 1 ? t("child").toLowerCase() : t("child_plural").toLowerCase()}{" "}
                queued for sign-out. The checkout will be recorded once the
                kiosk is back online and the queued request has synced.
              </p>
              {result.queuedAt && (
                <p className="text-xs text-muted-foreground">
                  Queued at {new Date(result.queuedAt).toLocaleTimeString()}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("child_plural")} queued for sign-out
              </CardTitle>
              <CardDescription className="text-xs">
                {selectedChildren.length} queued · {todayLabel}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {selectedChildren.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Baby className="h-4 w-4 text-amber-600 shrink-0" />
                    <span className="font-medium truncate">
                      {c.firstName} {c.lastName}
                      {c.preferredName ? ` (${c.preferredName})` : ""}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 uppercase tracking-wide">
                    {method}
                  </span>
                </div>
              ))}
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
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 flex-1 flex flex-col gap-6 pb-28">
          {/* Blocked alert (prominent, red) — happens when blacklist hard-stop fires */}
          {result.blocked.length > 0 && (
            <Alert variant="destructive">
              <ShieldAlert className="h-5 w-5" />
              <AlertTitle className="text-base">
                BLOCKED — Security has been alerted
              </AlertTitle>
              <AlertDescription>
                <p className="mb-2">
                  The following {t("child").toLowerCase()}(ren) could NOT be
                  checked out because the collector is on the blacklist:
                </p>
                <ul className="space-y-1">
                  {result.blocked.map((b) => {
                    const child = childList.find((c) => c.id === b.childPersonId);
                    return (
                      <li key={b.childPersonId} className="font-medium">
                        {child ? `${child.firstName} ${child.lastName}` : b.childPersonId}
                        {" — "}
                        {b.reason === "blacklisted" && (
                          <span className="text-destructive">
                            blocked (hard-stop, never overridable)
                          </span>
                        )}
                        {b.reason === "flagged_requires_override" && (
                          <span>flagged — use Override tab</span>
                        )}
                        {b.reason === "not_authorised" && (
                          <span>not authorised — use Override tab</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs mt-2">
                  A <code>checkout.blocked</code> entry has been written to the
                  audit log and is visible to Security staff.
                </p>
              </AlertDescription>
            </Alert>
          )}

          <div className="text-center space-y-2">
            <div
              className={`mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl ${
                result.checkedOut.length > 0
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">
              {result.checkedOut.length > 0
                ? `${result.checkedOut.length} ${
                    result.checkedOut.length === 1
                      ? t("child").toLowerCase()
                      : t("child_plural").toLowerCase()
                  } signed out`
                : "Check-out complete"}
            </h1>
            <p className="text-sm text-muted-foreground">{todayLabel}</p>
          </div>

          {result.checkedOut.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {t("child_plural")} signed out
                </CardTitle>
                <CardDescription className="text-xs">
                  {result.checkedOut.length} signed out
                  {result.skipped.length > 0
                    ? ` · ${result.skipped.length} already out`
                    : ""}
                  {result.blocked.length > 0
                    ? ` · ${result.blocked.length} blocked`
                    : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {result.checkedOut.map((c) => {
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
                      <span className="text-xs text-muted-foreground shrink-0 uppercase tracking-wide">
                        {c.method}
                      </span>
                    </div>
                  );
                })}
                {result.skipped.length > 0 && (
                  <p className="text-xs text-muted-foreground px-1 pt-1">
                    {result.skipped.length} already checked out — not duplicated.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

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

  // ---------------------------------------------------------------
  // CHECK-OUT FORM SCREEN
  // ---------------------------------------------------------------
  // Photo verification block (only shown if flag ON and at least one
  // selected child has a photo OR the collector has a photo).
  const showPhotoBlock = photoVerification && selectedCount > 0;
  // Selected children with photos.
  const photoChildren = selectedChildren;

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
            <ShieldCheck className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight truncate">
              Check out — {familyName}
            </h1>
            <p className="text-sm text-muted-foreground">{todayLabel}</p>
          </div>
        </div>

        {/* Method selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" /> 1. Pick a check-out method
            </CardTitle>
            <CardDescription className="text-xs">
              Quick code = the family&apos;s daily code · Guardian PIN = verify
              yourself · Override = staff-only, for flagged/unusual cases.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid sm:grid-cols-3 gap-2">
              <MethodCard
                active={method === "code"}
                onClick={() => setMethod("code")}
                icon={<KeyRound className="h-5 w-5" />}
                title="Quick code"
                description="Enter today's code"
              />
              <MethodCard
                active={method === "pin"}
                onClick={() => guardianPinSignin && setMethod("pin")}
                disabled={!guardianPinSignin}
                icon={<Lock className="h-5 w-5" />}
                title="Guardian PIN"
                description={
                  guardianPinSignin ? "Verify as carer/guardian" : "Disabled by admin"
                }
              />
              <MethodCard
                active={method === "override"}
                onClick={() => overrideCheckout && setMethod("override")}
                disabled={!overrideCheckout}
                icon={<ShieldAlert className="h-5 w-5" />}
                title="Override (staff)"
                description={
                  !overrideCheckout
                    ? "Disabled by admin"
                    : !isStaff
                      ? "Sign in as staff"
                      : "Authorise unusual case"
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Children selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Baby className="h-4 w-4 text-primary" /> 2. Select {t("child_plural").toLowerCase()} to sign out
            </CardTitle>
            <CardDescription className="text-xs">
              Allergies + medical notes are shown here for safety.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {checkedInChildren.length === 0 && (
              <div className="rounded-md bg-muted/40 p-4 text-sm text-muted-foreground flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
                <p>
                  No {t("child_plural").toLowerCase()} currently checked in.
                  {checkedOutChildren.length > 0 &&
                    ` (${checkedOutChildren.length} already signed out today — see below.)`}
                </p>
              </div>
            )}
            {checkedInChildren.map((c) => {
              const isSelected = selectedChildIds.has(c.id);
              const hasAllergies = !!c.allergies && c.allergies.trim().length > 0;
              const hasMedical = !!c.medicalNotes && c.medicalNotes.trim().length > 0;
              const hasAlert = hasAllergies || hasMedical;
              return (
                <div
                  key={c.id}
                  className={`rounded-xl border p-3 space-y-3 ${
                    hasAlert ? "border-destructive/40 bg-destructive/5" : "bg-card"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`chk-${c.id}`}
                      checked={isSelected}
                      onCheckedChange={() => toggleChild(c.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <label
                          htmlFor={`chk-${c.id}`}
                          className="font-medium cursor-pointer"
                        >
                          {c.firstName} {c.lastName}
                          {c.preferredName ? ` (${c.preferredName})` : ""}
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
                        {c.className ? `${c.className}` : "No class"}
                        {c.roomName ? ` · ${c.roomName}` : ""}
                      </p>
                    </div>
                    {hasAlert && (
                      <Badge variant="destructive" className="gap-1 shrink-0">
                        <AlertTriangle className="h-3 w-3" /> Alert
                      </Badge>
                    )}
                  </div>

                  {hasAlert && (
                    <div className="space-y-1.5">
                      {hasAllergies && (
                        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                          <p className="font-semibold">Allergy: {c.allergies}</p>
                        </div>
                      )}
                      {hasMedical && (
                        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive flex items-start gap-2">
                          <HeartPulse className="h-4 w-4 mt-0.5 shrink-0" />
                          <p className="font-semibold">Medical: {c.medicalNotes}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {checkedOutChildren.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground pt-2">
                  Already signed out today:
                </p>
                {checkedOutChildren.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between gap-2 opacity-80"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span className="font-medium truncate">
                        {c.firstName} {c.lastName}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {c.checkoutMethod} ✓
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* METHOD-SPECIFIC BLOCKS */}
        {method === "code" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" /> 3. Enter today&apos;s daily code
              </CardTitle>
              <CardDescription className="text-xs">
                The {dailyCodeLength}-character code shown at check-in.{" "}
                {dailyCodeCharset === "numeric" ? "Numbers only." : "Letters + numbers."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <Input
                value={codeEntry}
                onChange={(e) => onCodeChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && selectedCount > 0) submit();
                }}
                inputMode={dailyCodeCharset === "numeric" ? "numeric" : "text"}
                autoComplete="off"
                placeholder={"•".repeat(dailyCodeLength)}
                className="h-16 text-3xl font-mono tracking-[0.4em] text-center uppercase"
                maxLength={dailyCodeLength}
                aria-label="Daily code"
              />
              <p className="text-[11px] text-muted-foreground">
                Lost the code? Switch to Guardian PIN or ask staff for an override.
              </p>
            </CardContent>
          </Card>
        )}

        {method === "pin" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" /> 3. Verify with your PIN
              </CardTitle>
              <CardDescription className="text-xs">
                Enter your 4–6 digit PIN. The check-out will be attributed to you.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {verifiedGuardian ? (
                <div className="rounded-md border bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 min-w-0">
                    <UserCheck className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      Verified: <strong>{verifiedGuardian.name}</strong>
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearPin}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-2 py-2">
                    <div
                      className="flex items-center justify-center gap-2 rounded-md border bg-muted/30 px-4 py-3 min-h-[3.5rem] min-w-[10rem] text-2xl font-mono tracking-[0.4em]"
                      aria-live="polite"
                      aria-label="PIN entry"
                    >
                      {pinEntry.length === 0 ? (
                        <span className="text-muted-foreground text-base tracking-normal">
                          Enter PIN
                        </span>
                      ) : (
                        "•".repeat(pinEntry.length)
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                      <Button
                        key={d}
                        type="button"
                        variant="outline"
                        className="h-14 text-xl"
                        onClick={() => pressPin(d)}
                        disabled={verifyingPin}
                        aria-label={`Digit ${d}`}
                      >
                        {d}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-14"
                      onClick={() => setPinEntry("")}
                      disabled={verifyingPin || pinEntry.length === 0}
                      aria-label="Clear PIN"
                    >
                      Clear
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-14 text-xl"
                      onClick={() => pressPin("0")}
                      disabled={verifyingPin}
                      aria-label="Digit 0"
                    >
                      0
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-14"
                      onClick={backspacePin}
                      disabled={verifyingPin || pinEntry.length === 0}
                      aria-label="Backspace"
                    >
                      <Delete className="h-5 w-5" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    className="w-full h-14 text-base"
                    onClick={() => void verifyPin()}
                    disabled={verifyingPin || pinEntry.length < 4}
                  >
                    {verifyingPin ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Verifying…
                      </>
                    ) : (
                      "Verify PIN"
                    )}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {method === "override" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive" /> 3. Override authorisation
              </CardTitle>
              <CardDescription className="text-xs">
                {isStaff ? (
                  <>
                    Signed in as <strong>{staffName}</strong>. Use this only
                    after contacting an authorised carer/guardian by phone.
                  </>
                ) : (
                  <>Sign in as Admin / Teacher / Security to use override.</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              {!isStaff ? (
                <Alert>
                  <Lock className="h-4 w-4" />
                  <AlertTitle>Staff sign-in required</AlertTitle>
                  <AlertDescription>
                    Override check-out is only available to Admin, Teacher, or
                    Security roles.{" "}
                    <Link href="/login" className="underline">
                      Sign in
                    </Link>{" "}
                    then return here.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  {/* Collector identification — search Person OR free-text name */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={overrideCollectorMode === "person" ? "default" : "outline"}
                        onClick={() => {
                          setOverrideCollectorMode("person");
                          setCollectorName("");
                        }}
                      >
                        Search person
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={overrideCollectorMode === "freetext" ? "default" : "outline"}
                        onClick={() => {
                          setOverrideCollectorMode("freetext");
                          setCollectorPersonId(null);
                        }}
                      >
                        Enter name (free-text)
                      </Button>
                    </div>

                    {overrideCollectorMode === "person" ? (
                      <div className="space-y-2">
                        {collectorPersonId ? (
                          <div className="rounded-md border bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 min-w-0">
                              <UserCheck className="h-4 w-4 shrink-0" />
                              <span className="truncate">
                                {(() => {
                                  const hit = collectorSearchHits.find(
                                    (h) => h.id === collectorPersonId,
                                  );
                                  // Also check the family adults list
                                  const adult = adults.find((a) => a.id === collectorPersonId);
                                  const name = hit
                                    ? `${hit.firstName} ${hit.lastName}`
                                    : adult
                                      ? `${adult.firstName} ${adult.lastName}`
                                      : collectorPersonId;
                                  return name;
                                })()}
                              </span>
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => setCollectorPersonId(null)}
                            >
                              Change
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                value={collectorSearchQuery}
                                onChange={(e) => setCollectorSearchQuery(e.target.value)}
                                placeholder="Search by name / email / phone"
                                className="h-12 pl-9"
                                autoComplete="off"
                              />
                              {collectorSearchLoading && (
                                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
                              )}
                            </div>
                            {/* Family adults quick-pick */}
                            {adults.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                <span className="text-[11px] text-muted-foreground self-center">
                                  Family adults:
                                </span>
                                {adults.map((a) => (
                                  <button
                                    key={a.id}
                                    type="button"
                                    className="text-xs rounded-md border px-2 py-1 hover:bg-accent/40 transition-colors"
                                    onClick={() => setCollectorPersonId(a.id)}
                                  >
                                    {a.firstName} {a.lastName}{" "}
                                    <span className="text-[10px] text-muted-foreground uppercase">
                                      {a.role === "PrimaryCarer" ? t("carer") : t("guardian")}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {/* Search hits */}
                            {collectorSearchHits.length > 0 && (
                              <div className="rounded-md border max-h-48 overflow-y-auto divide-y">
                                {collectorSearchHits.map((h) => (
                                  <button
                                    key={h.id}
                                    type="button"
                                    className="w-full text-left p-2.5 text-sm hover:bg-accent/40 flex items-center justify-between"
                                    onClick={() => setCollectorPersonId(h.id)}
                                  >
                                    <span>
                                      {h.firstName} {h.lastName}
                                    </span>
                                    <Badge variant="outline" className="text-[10px]">
                                      {h.personType}
                                    </Badge>
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Label htmlFor="collector-name" className="text-xs">
                          Collector name (free-text — for unknown adults)
                        </Label>
                        <Input
                          id="collector-name"
                          value={collectorName}
                          onChange={(e) => setCollectorName(e.target.value)}
                          placeholder="e.g. Jane Doe (aunt)"
                          className="h-12"
                          autoComplete="off"
                        />
                      </div>
                    )}
                  </div>

                  {/* Mandatory confirmation checkbox */}
                  <label className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 cursor-pointer">
                    <Checkbox
                      checked={overrideConfirmed}
                      onCheckedChange={(v) => setOverrideConfirmed(v === true)}
                      className="mt-0.5"
                    />
                    <span className="text-sm">
                      <strong className="text-amber-900 dark:text-amber-200">
                        I have contacted and confirmed with an authorised
                        carer/guardian that this person may collect the
                        child(ren).
                      </strong>
                      <br />
                      <span className="text-xs text-amber-800 dark:text-amber-300">
                        Required. The carer name + phone number should be in the
                        note below.
                      </span>
                    </span>
                  </label>

                  {/* Mandatory free-text note */}
                  <div className="space-y-1.5">
                    <Label htmlFor="override-note" className="text-xs">
                      Reason / details <span className="text-destructive">*</span> (min 10 chars)
                    </Label>
                    <Textarea
                      id="override-note"
                      value={overrideNote}
                      onChange={(e) => setOverrideNote(e.target.value)}
                      placeholder="e.g. Spoke with John Smith (Primary Carer) on 0412 345 678 at 11:30 — confirmed Jane Doe (aunt) may collect Mary."
                      className="min-h-24"
                      maxLength={4000}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {overrideNote.trim().length}/10 chars minimum
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Photo verification (per photo_verification flag) */}
        {showPhotoBlock && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="h-4 w-4 text-primary" /> 4. Photo verification
              </CardTitle>
              <CardDescription className="text-xs">
                Visually verify the collector matches the photo on file before
                signing out.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {photoChildren.slice(0, 2).map((c) => (
                  <PhotoTile
                    key={c.id}
                    personId={c.id}
                    label={`${c.firstName} ${c.lastName}`}
                    subLabel={c.ageYears !== null ? `${c.ageYears} yrs` : "Child"}
                    hasPhoto={c.hasPhoto}
                  />
                ))}
                {photoChildren.length > 2 && (
                  <div className="col-span-2 text-xs text-muted-foreground">
                    + {photoChildren.length - 2} more selected.
                  </div>
                )}
                {method === "pin" && verifiedGuardian && (
                  <PhotoTile
                    personId={verifiedGuardian.personId}
                    label={verifiedGuardian.name}
                    subLabel="Collector (verified PIN)"
                    hasPhoto={
                      adults.find((a) => a.id === verifiedGuardian.personId)?.hasPhoto ?? false
                    }
                  />
                )}
                {method === "override" &&
                  overrideCollectorMode === "person" &&
                  collectorPersonId && (
                    <PhotoTile
                      personId={collectorPersonId}
                      label={
                        collectorSearchHits.find((h) => h.id === collectorPersonId)
                          ? `${collectorSearchHits.find((h) => h.id === collectorPersonId)!.firstName} ${
                              collectorSearchHits.find((h) => h.id === collectorPersonId)!.lastName
                            }`
                          : "Collector"
                      }
                      subLabel="Collector (override)"
                      hasPhoto={adults.find((a) => a.id === collectorPersonId)?.hasPhoto ?? false}
                    />
                  )}
              </div>
              <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                <Checkbox
                  checked={photoVerified}
                  onCheckedChange={(v) => setPhotoVerified(v === true)}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  I have visually verified the collector matches the photo on
                  file.
                </span>
              </label>
            </CardContent>
          </Card>
        )}
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
            disabled={submitting || selectedCount === 0 || !canSubmit()}
            onClick={submit}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Signing out…
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-5 w-5" />
                Sign out {selectedCount}{" "}
                {selectedCount === 1 ? t("child") : t("child_plural")}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  function canSubmit(): boolean {
    if (method === "code") return codeEntry.trim().length > 0;
    if (method === "pin") return !!verifiedGuardian;
    if (method === "override") {
      if (!isStaff) return false;
      if (!overrideConfirmed) return false;
      if (overrideNote.trim().length < 10) return false;
      if (overrideCollectorMode === "person" && !collectorPersonId) return false;
      if (overrideCollectorMode === "freetext" && collectorName.trim().length < 2)
        return false;
    }
    if (photoVerification && !photoVerified) return false;
    return true;
  }
}

// ---------------------------------------------------------------------------
// MethodCard subcomponent
// ---------------------------------------------------------------------------

function MethodCard({
  active,
  onClick,
  disabled,
  icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-14 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "border-primary bg-primary/10 ring-1 ring-primary"
          : "border-border bg-card hover:bg-accent/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
        <span className="font-medium text-sm">{title}</span>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{description}</p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// PhotoTile — shows a person's photo (or initials fallback) via
// /api/people/[id]/photo. Gracefully degrades to an initials avatar if the
// request fails (e.g. open-kiosk mode where there's no auth session).
// ---------------------------------------------------------------------------

function PhotoTile({
  personId,
  label,
  subLabel,
  hasPhoto,
}: {
  personId: string;
  label: string;
  subLabel: string;
  hasPhoto: boolean;
}) {
  const [errored, setErrored] = useState(false);
  const initials = label
    .split(" ")
    .map((p) => p[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
      <div className="h-16 w-16 rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0">
        {!errored && hasPhoto ? (
          <img
            src={`/api/people/${personId}/photo`}
            alt={label}
            className="h-full w-full object-cover"
            onError={() => setErrored(true)}
          />
        ) : (
          <span className="text-2xl font-semibold text-muted-foreground">{initials || "?"}</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{label}</p>
        <p className="text-xs text-muted-foreground">{subLabel}</p>
        {!hasPhoto && (
          <p className="text-[10px] text-muted-foreground mt-0.5">No photo on file</p>
        )}
      </div>
    </div>
  );
}
