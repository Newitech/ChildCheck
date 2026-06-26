"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  ExternalLink,
  HeartPulse,
  Loader2,
  LogOut,
  Mail,
  MinusCircle,
  PlusCircle,
  Printer,
  RefreshCw,
  ShieldAlert,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { useFlags } from "@/hooks/use-flags";
import { useRealtime } from "@/hooks/use-realtime";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

// ---------------------------------------------------------------------------
// Types — mirror the API response shapes.
// ---------------------------------------------------------------------------

interface RosterChild {
  checkInRecordId: string;
  childPersonId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  fullName: string;
  ageYears: number | null;
  dateOfBirth: string | null;
  isVisitor: boolean;
  hasPhoto: boolean;
  photoPath: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  dietaryNotes: string | null;
  hasAlerts: boolean;
  familyId: string;
  familyName: string;
  classId: string | null;
  className: string | null;
  programId: string | null;
  programName: string | null;
  roomId: string | null;
  roomName: string | null;
  checkInSessionId: string;
  eventId: string | null;
  checkedInAt: string;
  method: string;
  dailyCode: string;
}

interface HeadcountLogItem {
  id: string;
  roomId: string | null;
  classId: string | null;
  checkInSessionId: string | null;
  count: number;
  notes: string | null;
  createdAt: string;
  reportedById: string;
  reportedByName: string;
}

interface RoomOption { id: string; name: string; code: string | null; building: string | null; capacity: number | null; }
interface ClassOption { id: string; name: string; programId: string; programName: string; roomId: string | null; roomName: string | null; ageMin: number | null; ageMax: number | null; }
interface ProgramOption { id: string; name: string; slug: string; color: string | null; }
interface EventOption {
  id: string;
  name: string;
  date: string;        // ISO
  endDate: string | null;
  location: string | null;
  programId: string | null;
  programName: string | null;
}

interface ScopeOptions {
  rooms: RoomOption[];
  classes: ClassOption[];
  programs: ProgramOption[];
  events: EventOption[];
}

interface ReportItem {
  checkInRecordId: string;
  childPersonId: string;
  childName: string;
  familyId: string;
  familyName: string;
  programId: string | null;
  programName: string | null;
  classId: string | null;
  className: string | null;
  roomId: string | null;
  roomName: string | null;
  checkedInAt: string;
  checkedOutAt: string | null;
  durationMinutes: number | null;
  method: string;
  checkoutMethod: string | null;
  overrideNote: string | null;
  hasAlerts: boolean;
  allergies: string | null;
  medicalNotes: string | null;
}

interface ReportSummary {
  totalCheckIns: number;
  uniqueChildren: number;
  stillInCare: number;
  checkedOut: number;
  withAlerts: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elapsedMinutes(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function formatElapsed(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function todayIsoDate(): string {
  // YYYY-MM-DD in local time — used as the default for date inputs.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  user: { id: string; name: string | null; username: string; roles: string[] };
  initialScopeOptions: ScopeOptions;
  photoVerificationEnabled: boolean;
  overrideCheckoutEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VolunteerDashboard({
  user,
  initialScopeOptions,
  photoVerificationEnabled,
  overrideCheckoutEnabled,
}: Props) {
  const { t } = useTerminology();
  const { isEnabled } = useFlags();
  const isStaff = useMemo(
    () =>
      user.roles.includes("Admin") ||
      user.roles.includes("Security") ||
      user.roles.includes("Teacher"),
    [user.roles],
  );
  const canCheckIn = useMemo(() => {
    return (
      user.roles.includes("Admin") ||
      user.roles.includes("Teacher") ||
      user.roles.includes("Volunteer")
    );
  }, [user.roles]);
  const canCheckOut = canCheckIn;
  const canOverride = useMemo(
    () => isStaff && overrideCheckoutEnabled,
    [isStaff, overrideCheckoutEnabled],
  );

  const scopeOptions = initialScopeOptions;

  // Scope selectors. "all" = no specific scope, show ALL currently-checked-in
  // children across the org. "event" = pick an event, show children checked
  // in to that event's session.
  const [scopeKind, setScopeKind] = useState<"all" | "program" | "class" | "room" | "event">("all");
  const [programId, setProgramId] = useState<string>("");
  const [classId, setClassId] = useState<string>("");
  const [roomId, setRoomId] = useState<string>("");
  const [eventId, setEventId] = useState<string>("");
  const [date, setDate] = useState<string>(todayIsoDate());

  // Default the program selector to the first active program today, if any.
  // (Only relevant once the user switches scope to "program".)
  useEffect(() => {
    if (!programId && scopeOptions.programs.length > 0) {
      setProgramId(scopeOptions.programs[0].id);
    }
  }, [scopeOptions.programs, programId]);

  // Default the event selector to the first upcoming event, if any.
  useEffect(() => {
    if (!eventId && scopeOptions.events.length > 0) {
      setEventId(scopeOptions.events[0].id);
    }
  }, [scopeOptions.events, eventId]);

  // Derived scope query params. "all" returns null across the board — the
  // roster/report APIs interpret "no scope" as "all checked-in children for
  // the date". For the other scope kinds, we wait until the user has picked
  // a specific id before populating (so the roster doesn't fetch with a
  // half-picked scope).
  const activeScope = useMemo(() => {
    if (scopeKind === "all") return { classId: null, roomId: null, programId: null, eventId: null };
    if (scopeKind === "event" && eventId) return { classId: null, roomId: null, programId: null, eventId };
    if (scopeKind === "class" && classId) return { classId, roomId: null, programId: null, eventId: null };
    if (scopeKind === "room" && roomId) return { classId: null, roomId, programId: null, eventId: null };
    if (scopeKind === "program" && programId) return { classId: null, roomId: null, programId, eventId: null };
    return { classId: null, roomId: null, programId: null, eventId: null };
  }, [scopeKind, classId, roomId, programId, eventId]);

  // The realtime room name to join — matches roomsForScope() on the server.
  // For "all" scope we join the global `org:all` channel so any check-in/out
  // across the org refreshes the dashboard. For "event" we join `event:<id>`.
  const realtimeRoom = useMemo<string | null>(() => {
    if (scopeKind === "all") return "org:all";
    if (activeScope.eventId) return `event:${activeScope.eventId}`;
    if (activeScope.roomId) return `room:${activeScope.roomId}`;
    if (activeScope.classId) return `class:${activeScope.classId}`;
    if (activeScope.programId) return `program:${activeScope.programId}`;
    return null;
  }, [scopeKind, activeScope]);

  // Whether the current scope is one that the headcount panel can record
  // against (it needs a room or class — events + "all" don't have one).
  const headcountAvailable =
    scopeKind !== "all" && scopeKind !== "event" && (!!activeScope.roomId || !!activeScope.classId);

  // Roster state.
  const [roster, setRoster] = useState<RosterChild[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const rosterSeq = useRef(0);

  const fetchRoster = useCallback(async () => {
    // For "all" scope we fetch with NO scope params (the API returns all
    // checked-in children for the date). For the other scope kinds we wait
    // until the user has picked a specific id.
    if (scopeKind !== "all") {
      if (!activeScope.programId && !activeScope.classId && !activeScope.roomId && !activeScope.eventId) {
        setRoster([]);
        return;
      }
    }
    const mySeq = ++rosterSeq.current;
    setRosterLoading(true);
    setRosterError(null);
    try {
      const params = new URLSearchParams();
      if (activeScope.programId) params.set("programId", activeScope.programId);
      if (activeScope.classId) params.set("classId", activeScope.classId);
      if (activeScope.roomId) params.set("roomId", activeScope.roomId);
      if (activeScope.eventId) params.set("eventId", activeScope.eventId);
      params.set("date", date);
      const res = await fetch(`/api/volunteer/roster?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: RosterChild[] };
      if (mySeq !== rosterSeq.current) return; // a newer fetch is in flight
      setRoster(data.items ?? []);
    } catch (err) {
      if (mySeq !== rosterSeq.current) return;
      setRosterError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mySeq === rosterSeq.current) setRosterLoading(false);
    }
  }, [scopeKind, activeScope.programId, activeScope.classId, activeScope.roomId, activeScope.eventId, date]);

  // Initial load + on scope change.
  useEffect(() => {
    void fetchRoster();
  }, [fetchRoster]);

  // Realtime handler — refetch on any event (simplest correct approach).
  const onRealtimeEvent = useCallback(() => {
    void fetchRoster();
    void fetchHeadcounts();
  }, [fetchRoster]);

  const { connected: realtimeConnected } = useRealtime(realtimeRoom, onRealtimeEvent);

  // Polling fallback every 30s — covers the case where realtime is down or
  // the browser tab was opened before the realtime service started.
  useEffect(() => {
    const h = setInterval(() => {
      void fetchRoster();
      void fetchHeadcounts();
    }, 30_000);
    return () => clearInterval(h);
  }, [fetchRoster]);

  // ---- Headcount panel ----
  const [headcountInput, setHeadcountInput] = useState<string>("");
  const [headcountNotes, setHeadcountNotes] = useState<string>("");
  const [headcountResult, setHeadcountResult] = useState<{
    recorded: number;
    expected: number;
    discrepancy: number;
    recordedAt: string;
  } | null>(null);
  const [headcountSubmitting, setHeadcountSubmitting] = useState(false);
  const [headcountHistory, setHeadcountHistory] = useState<HeadcountLogItem[]>([]);

  const fetchHeadcounts = useCallback(async () => {
    // Headcounts are keyed on roomId/classId — "all" and "event" scopes
    // don't have one, so there's nothing to fetch.
    if (!activeScope.roomId && !activeScope.classId) {
      setHeadcountHistory([]);
      return;
    }
    try {
      const params = new URLSearchParams();
      if (activeScope.roomId) params.set("roomId", activeScope.roomId);
      if (activeScope.classId) params.set("classId", activeScope.classId);
      params.set("date", date);
      const res = await fetch(`/api/volunteer/headcounts?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { items: HeadcountLogItem[] };
      setHeadcountHistory(data.items ?? []);
    } catch {
      // best-effort
    }
  }, [activeScope.roomId, activeScope.classId, date]);

  useEffect(() => {
    void fetchHeadcounts();
    setHeadcountResult(null);
  }, [fetchHeadcounts]);

  async function submitHeadcount() {
    const count = parseInt(headcountInput, 10);
    if (Number.isNaN(count) || count < 0) {
      toast.error("Enter a valid whole number for the headcount");
      return;
    }
    if (!headcountAvailable) {
      toast.error("Pick a room or class scope to record a headcount against");
      return;
    }
    setHeadcountSubmitting(true);
    try {
      const res = await fetch("/api/volunteer/headcount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: activeScope.roomId ?? null,
          classId: activeScope.classId ?? null,
          count,
          notes: headcountNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        recorded: number;
        expected: number;
        discrepancy: number;
        recordedAt: string;
      };
      setHeadcountResult(data);
      if (data.discrepancy === 0) {
        toast.success(`Headcount matches: ${data.recorded} children`);
      } else if (data.discrepancy > 0) {
        toast.warning(`Discrepancy: ${data.discrepancy} more than system count`);
      } else {
        toast.warning(`Discrepancy: ${Math.abs(data.discrepancy)} fewer than system count`);
      }
      setHeadcountInput("");
      setHeadcountNotes("");
      void fetchHeadcounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setHeadcountSubmitting(false);
    }
  }

  // ---- Manual checkout dialog ----
  const [checkoutTarget, setCheckoutTarget] = useState<RosterChild | null>(null);
  const [checkoutReason, setCheckoutReason] = useState("");
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);

  async function submitManualCheckout() {
    if (!checkoutTarget) return;
    if (checkoutReason.trim().length < 3) {
      toast.error("Provide a short reason (min 3 chars)");
      return;
    }
    setCheckoutSubmitting(true);
    try {
      const res = await fetch("/api/volunteer/manual-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childPersonId: checkoutTarget.childPersonId,
          reason: checkoutReason.trim(),
          checkInRecordId: checkoutTarget.checkInRecordId,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Checked out ${checkoutTarget.fullName}`);
      setCheckoutTarget(null);
      setCheckoutReason("");
      void fetchRoster();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckoutSubmitting(false);
    }
  }

  // ---- Override checkout dialog ----
  const [overrideTarget, setOverrideTarget] = useState<RosterChild | null>(null);
  const [overrideNote, setOverrideNote] = useState("");
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [overrideCollector, setOverrideCollector] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  async function submitOverrideCheckout() {
    if (!overrideTarget) return;
    if (!overrideConfirmed) {
      toast.error("Tick the confirmation checkbox first");
      return;
    }
    if (overrideNote.trim().length < 10) {
      toast.error("Override note must be at least 10 characters");
      return;
    }
    setOverrideSubmitting(true);
    try {
      const res = await fetch("/api/volunteer/override-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childPersonId: overrideTarget.childPersonId,
          checkInRecordId: overrideTarget.checkInRecordId,
          collectorPersonId: overrideCollector.trim() || null,
          note: overrideNote.trim(),
          confirmed: overrideConfirmed,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string; reason?: string };
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Override checkout complete for ${overrideTarget.fullName}`);
      setOverrideTarget(null);
      setOverrideNote("");
      setOverrideConfirmed(false);
      setOverrideCollector("");
      void fetchRoster();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setOverrideSubmitting(false);
    }
  }

  // ---- Reports tab ----
  const [reportFrom, setReportFrom] = useState<string>(todayIsoDate());
  const [reportTo, setReportTo] = useState<string>(todayIsoDate());
  const [reportItems, setReportItems] = useState<ReportItem[]>([]);
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const params = new URLSearchParams();
      if (activeScope.programId) params.set("programId", activeScope.programId);
      if (activeScope.classId) params.set("classId", activeScope.classId);
      if (activeScope.roomId) params.set("roomId", activeScope.roomId);
      if (activeScope.eventId) params.set("eventId", activeScope.eventId);
      params.set("dateFrom", reportFrom);
      params.set("dateTo", reportTo);
      const res = await fetch(`/api/volunteer/report?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        items: ReportItem[];
        summary: ReportSummary;
      };
      setReportItems(data.items ?? []);
      setReportSummary(data.summary);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : String(err));
    } finally {
      setReportLoading(false);
    }
  }, [activeScope.programId, activeScope.classId, activeScope.roomId, activeScope.eventId, reportFrom, reportTo]);

  useEffect(() => {
    // Auto-load when the user opens the Reports tab if we haven't loaded yet.
    // (Triggered manually below on tab change to avoid an extra fetch on mount.)
  }, []);

  function downloadCsv() {
    const params = new URLSearchParams();
    if (activeScope.programId) params.set("programId", activeScope.programId);
    if (activeScope.classId) params.set("classId", activeScope.classId);
    if (activeScope.roomId) params.set("roomId", activeScope.roomId);
    if (activeScope.eventId) params.set("eventId", activeScope.eventId);
    params.set("dateFrom", reportFrom);
    params.set("dateTo", reportTo);
    params.set("format", "csv");
    // Trigger download via a hidden link.
    const a = document.createElement("a");
    a.href = `/api/volunteer/report?${params.toString()}`;
    a.rel = "noopener";
    a.click();
    toast.success("CSV download started");
  }

  // ---- Render ----
  const systemCount = roster.length;

  return (
    <div className="space-y-6">
      {/* Header card */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-2xl flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              Hello, {user.name ?? user.username}
            </CardTitle>
            <CardDescription>
              Live rosters, headcounts, manual check-in/out and reports — for {t("volunteer").toLowerCase()}s and teachers.
            </CardDescription>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {user.roles.map((r) => (
                <Badge key={r} variant="secondary" className="text-[10px]">
                  {r}
                </Badge>
              ))}
              <Badge
                variant={realtimeConnected ? "default" : "outline"}
                className="text-[10px] gap-1"
                title={realtimeConnected ? "Realtime connected" : "Realtime offline — polling every 30s"}
              >
                {realtimeConnected ? (
                  <>
                    <Wifi className="h-3 w-3" /> Live
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3 w-3" /> Polling
                  </>
                )}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {user.roles.includes("Admin") && (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin">
                  <ExternalLink className="h-4 w-4" /> Admin
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/kiosk">Open kiosk</Link>
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Scope selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Choose a scope
          </CardTitle>
          <CardDescription>
            Pick what to view — All (every checked-in child), a Program, {t("group").toLowerCase()}, {t("room").toLowerCase()}, or an Event. The roster, headcount and report tabs all use this scope.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Scope by</Label>
              <Select value={scopeKind} onValueChange={(v) => setScopeKind(v as "all" | "program" | "class" | "room" | "event")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All (whole org)</SelectItem>
                  <SelectItem value="program">Program</SelectItem>
                  <SelectItem value="class">{t("group")}</SelectItem>
                  <SelectItem value="room">{t("room")}</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scopeKind === "all" && (
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                <Label className="text-xs text-muted-foreground">Scope</Label>
                <div className="flex items-center h-9 px-3 rounded-md border bg-muted/30 text-sm text-muted-foreground">
                  All currently-checked-in children across the org for the selected date.
                </div>
              </div>
            )}

            {scopeKind === "program" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Program</Label>
                <Select value={programId} onValueChange={setProgramId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select program" />
                  </SelectTrigger>
                  <SelectContent>
                    {scopeOptions.programs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {scopeKind === "class" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs text-muted-foreground">{t("group")}</Label>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {scopeOptions.classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.programName} · {c.name}
                        {c.roomName ? ` (${c.roomName})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {scopeKind === "room" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("room")}</Label>
                <Select value={roomId} onValueChange={setRoomId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select room" />
                  </SelectTrigger>
                  <SelectContent>
                    {scopeOptions.rooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                        {r.building ? ` · ${r.building}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {scopeKind === "event" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs text-muted-foreground">Event</Label>
                {scopeOptions.events.length === 0 ? (
                  <div className="flex items-center h-9 px-3 rounded-md border bg-muted/30 text-sm text-muted-foreground">
                    No upcoming active events. Create one in Admin → Events.
                  </div>
                ) : (
                  <Select value={eventId} onValueChange={setEventId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select event" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {scopeOptions.events.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                          {` · ${new Date(e.date).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}`}
                          {e.programName ? ` · ${e.programName}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value || todayIsoDate())}
              />
            </div>

            <div className="flex items-end gap-2">
              <Button variant="outline" size="sm" onClick={() => void fetchRoster()} disabled={rosterLoading}>
                <RefreshCw className={`h-4 w-4 ${rosterLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="roster" className="space-y-4">
        <TabsList>
          <TabsTrigger value="roster">
            <Users className="h-4 w-4" /> Live roster
          </TabsTrigger>
          <TabsTrigger value="headcount">
            <Activity className="h-4 w-4" /> Headcount
          </TabsTrigger>
          <TabsTrigger value="reports">
            <CalendarDays className="h-4 w-4" /> Reports
          </TabsTrigger>
        </TabsList>

        {/* ---- ROSTER TAB ---- */}
        <TabsContent value="roster" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Currently in care
                  <Badge variant="secondary">{systemCount}</Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  {scopeKind === "all" && `All (whole org) scope`}
                  {scopeKind === "event" && activeScope.eventId && `Event scope`}
                  {activeScope.programId && `Program scope`}
                  {activeScope.classId && `${t("group")} scope`}
                  {activeScope.roomId && `${t("room")} scope`}
                  {` · ${date}`}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {rosterLoading && roster.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading roster…
                </div>
              ) : rosterError ? (
                <div className="flex items-center justify-center py-12 text-destructive">
                  <AlertTriangle className="h-5 w-5 mr-2" /> {rosterError}
                </div>
              ) : roster.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <MinusCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No children currently checked in for this scope.</p>
                </div>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto -mx-2 px-2">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Child</TableHead>
                        <TableHead className="hidden md:table-cell">{t("family")}</TableHead>
                        <TableHead className="hidden lg:table-cell">{t("group")} / {t("room")}</TableHead>
                        <TableHead className="hidden sm:table-cell">In since</TableHead>
                        <TableHead className="hidden sm:table-cell">Elapsed</TableHead>
                        <TableHead>Alerts</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roster.map((child) => (
                        <RosterRow
                          key={child.checkInRecordId}
                          child={child}
                          photoVerificationEnabled={photoVerificationEnabled}
                          canCheckOut={canCheckOut}
                          canOverride={canOverride}
                          onCheckout={() => {
                            setCheckoutTarget(child);
                            setCheckoutReason("");
                          }}
                          onOverride={() => {
                            setOverrideTarget(child);
                            setOverrideNote("");
                            setOverrideConfirmed(false);
                            setOverrideCollector("");
                          }}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- HEADCOUNT TAB ---- */}
        <TabsContent value="headcount" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Record a headcount
              </CardTitle>
              <CardDescription>
                Count the children physically present right now. We&apos;ll compare to the system check-in count and flag any discrepancy.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!headcountAvailable ? (
                <div className="text-sm text-muted-foreground">
                  {scopeKind === "all"
                    ? `Headcounts are keyed to a specific room or class. Switch scope to ${t("room").toLowerCase()} or ${t("group").toLowerCase()} to record one.`
                    : scopeKind === "event"
                      ? "Headcounts aren't supported for the Event scope (events have ad-hoc rooms). Switch to a room or class scope to record one."
                      : `Select a ${t("room").toLowerCase()} or ${t("group").toLowerCase()} scope above to record a headcount.`}
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5 sm:col-span-1">
                      <Label htmlFor="hc-count">Counted children</Label>
                      <Input
                        id="hc-count"
                        inputMode="numeric"
                        type="number"
                        min={0}
                        placeholder="e.g. 8"
                        value={headcountInput}
                        onChange={(e) => setHeadcountInput(e.target.value)}
                        className="text-2xl font-bold h-14 text-center"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="hc-notes">Notes (optional)</Label>
                      <Textarea
                        id="hc-notes"
                        placeholder="e.g. 1 child in bathroom, recounting in 5 min"
                        value={headcountNotes}
                        onChange={(e) => setHeadcountNotes(e.target.value)}
                        className="min-h-14"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={submitHeadcount}
                      disabled={headcountSubmitting || !headcountInput}
                    >
                      {headcountSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Record headcount
                    </Button>
                    <div className="text-sm text-muted-foreground">
                      System count: <strong className="text-foreground">{systemCount}</strong>
                    </div>
                  </div>

                  {headcountResult && (
                    <div
                      className={`rounded-lg border p-4 ${
                        headcountResult.discrepancy === 0
                          ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
                          : "border-red-400 bg-red-50 dark:bg-red-950/30"
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-4 text-sm">
                          <span>
                            Recorded:{" "}
                            <strong className="text-base">{headcountResult.recorded}</strong>
                          </span>
                          <span>
                            System count:{" "}
                            <strong className="text-base">{headcountResult.expected}</strong>
                          </span>
                          <span>
                            Discrepancy:{" "}
                            {headcountResult.discrepancy === 0 ? (
                              <Badge variant="default" className="ml-1 bg-emerald-600">
                                0 — match
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="ml-1">
                                {headcountResult.discrepancy > 0 ? "+" : ""}
                                {headcountResult.discrepancy}
                              </Badge>
                            )}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(headcountResult.recordedAt).toLocaleTimeString()}
                        </span>
                      </div>
                      {headcountResult.discrepancy !== 0 && (
                        <p className="text-xs mt-2 text-red-700 dark:text-red-300">
                          <ShieldAlert className="inline h-3 w-3 mr-1" />
                          Discrepancy detected. Investigate: a child may have wandered off, been picked up
                          without checkout, or not been checked in.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent headcounts</CardTitle>
              <CardDescription>
                The last 100 headcount logs recorded for this scope today.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {headcountHistory.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No headcounts recorded yet for this scope today.
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto -mx-2 px-2">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Count</TableHead>
                        <TableHead>By</TableHead>
                        <TableHead className="hidden md:table-cell">Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {headcountHistory.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell className="text-sm">
                            {new Date(h.createdAt).toLocaleTimeString()}
                          </TableCell>
                          <TableCell>
                            <strong>{h.count}</strong>
                          </TableCell>
                          <TableCell className="text-sm">{h.reportedByName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground hidden md:table-cell">
                            {h.notes ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- REPORTS TAB ---- */}
        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                Attendance report
              </CardTitle>
              <CardDescription>
                Check-in / check-out times and durations for the selected scope and date range.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={reportFrom}
                    onChange={(e) => setReportFrom(e.target.value || todayIsoDate())}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={reportTo}
                    onChange={(e) => setReportTo(e.target.value || todayIsoDate())}
                  />
                </div>
                <div className="flex items-end gap-2 sm:col-span-2 flex-wrap">
                  <Button onClick={() => void fetchReport()} disabled={reportLoading}>
                    {reportLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CalendarDays className="h-4 w-4" />
                    )}
                    Run report
                  </Button>
                  <Button variant="outline" onClick={downloadCsv} disabled={reportItems.length === 0}>
                    <Download className="h-4 w-4" />
                    Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => window.print()}
                    disabled={reportItems.length === 0}
                  >
                    <Printer className="h-4 w-4" />
                    Print
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const to = window.prompt(
                        "Email the attendance report to:",
                        "",
                      );
                      if (!to) return;
                      toast.info("Sending report email…");
                      try {
                        const res = await fetch("/api/admin/reports/email", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            reportType: "attendance",
                            to,
                            format: "csv",
                            params: {
                              programId: activeScope.programId || undefined,
                              classId: activeScope.classId || undefined,
                              roomId: activeScope.roomId || undefined,
                              eventId: activeScope.eventId || undefined,
                              dateFrom: reportFrom,
                              dateTo: reportTo,
                            },
                          }),
                        });
                        const data = (await res.json().catch(() => ({}))) as {
                          ok?: boolean;
                          error?: string;
                        };
                        if (res.status === 409 || data.error === "smtp_not_configured") {
                          toast.error("SMTP not configured", {
                            description: "Configure SMTP in Settings → Email first.",
                          });
                        } else if (!res.ok || !data.ok) {
                          toast.error("Could not send email", {
                            description: data.error ?? "Try again or check SMTP settings.",
                          });
                        } else {
                          toast.success("Report emailed to " + to);
                        }
                      } catch {
                        toast.error("Could not send email");
                      }
                    }}
                    disabled={reportItems.length === 0}
                  >
                    <Mail className="h-4 w-4" />
                    Email
                  </Button>
                </div>
              </div>

              {reportSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <SummaryStat label="Check-ins" value={reportSummary.totalCheckIns} icon={<PlusCircle className="h-3 w-3" />} />
                  <SummaryStat label="Unique children" value={reportSummary.uniqueChildren} icon={<Users className="h-3 w-3" />} />
                  <SummaryStat label="Still in care" value={reportSummary.stillInCare} icon={<Clock className="h-3 w-3" />} />
                  <SummaryStat label="Checked out" value={reportSummary.checkedOut} icon={<LogOut className="h-3 w-3" />} />
                  <SummaryStat label="With alerts" value={reportSummary.withAlerts} icon={<HeartPulse className="h-3 w-3" />} highlight={reportSummary.withAlerts > 0} />
                </div>
              )}

              {reportError ? (
                <div className="text-destructive text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> {reportError}
                </div>
              ) : reportItems.length === 0 && !reportLoading ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  Run the report to see attendance for the selected scope and date range.
                </div>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto -mx-2 px-2">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>Child</TableHead>
                        <TableHead className="hidden md:table-cell">Family</TableHead>
                        <TableHead className="hidden lg:table-cell">Program / Class</TableHead>
                        <TableHead>In</TableHead>
                        <TableHead>Out</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Alerts</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportItems.map((r) => (
                        <TableRow key={r.checkInRecordId}>
                          <TableCell className="font-medium">{r.childName}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm">{r.familyName}</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm">
                            {r.programName ?? "—"}
                            {r.className ? ` · ${r.className}` : ""}
                          </TableCell>
                          <TableCell className="text-sm">{formatTime(r.checkedInAt)}</TableCell>
                          <TableCell className="text-sm">
                            {r.checkedOutAt ? formatTime(r.checkedOutAt) : "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.durationMinutes != null ? formatElapsed(r.durationMinutes) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{r.method}</Badge>
                            {r.checkoutMethod && (
                              <Badge variant="secondary" className="text-[10px] ml-1">{r.checkoutMethod}</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {r.hasAlerts ? (
                              <Badge variant="destructive" className="text-[10px] gap-1">
                                <AlertTriangle className="h-3 w-3" /> alert
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---- Manual checkout dialog ---- */}
      <Dialog open={!!checkoutTarget} onOpenChange={(o) => !o && setCheckoutTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5" />
              Check out {checkoutTarget?.fullName ?? ""}
            </DialogTitle>
            <DialogDescription>
              You are manually checking out this child. The system trusts your staff session as
              authorisation — no daily code or guardian PIN is required. Please record the reason for
              the manual checkout (it is written to the audit log).
            </DialogDescription>
          </DialogHeader>
          {checkoutTarget && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div><strong>{checkoutTarget.fullName}</strong> · age {checkoutTarget.ageYears ?? "?"}</div>
                <div className="text-muted-foreground">{checkoutTarget.familyName}</div>
                <div className="text-muted-foreground">
                  In since {formatTime(checkoutTarget.checkedInAt)} ({formatElapsed(elapsedMinutes(checkoutTarget.checkedInAt))})
                </div>
                {checkoutTarget.hasAlerts && (
                  <div className="mt-2 text-red-700 dark:text-red-300 text-xs">
                    <AlertTriangle className="inline h-3 w-3 mr-1" />
                    This child has allergy/medical alerts — see roster row.
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="checkout-reason">Reason (min 3 chars)</Label>
                <Textarea
                  id="checkout-reason"
                  placeholder="e.g. Parent collected child directly from teacher at door"
                  value={checkoutReason}
                  onChange={(e) => setCheckoutReason(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutTarget(null)} disabled={checkoutSubmitting}>
              Cancel
            </Button>
            <Button onClick={submitManualCheckout} disabled={checkoutSubmitting || checkoutReason.trim().length < 3}>
              {checkoutSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm check-out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Override checkout dialog ---- */}
      <Dialog open={!!overrideTarget} onOpenChange={(o) => !o && setOverrideTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              Override checkout for {overrideTarget?.fullName ?? ""}
            </DialogTitle>
            <DialogDescription>
              Override is for situations where normal checkout authorisation (code/PIN) is not
              available — e.g. a flagged collector with phone-confirmed guardian approval, or an
              unknown adult with guardian phone-confirmation. The note + confirmation are mandatory.
              <strong className="block mt-1 text-amber-700 dark:text-amber-400">
                Blocked-severity blacklist entries can NEVER be overridden — not even by an Admin.
              </strong>
            </DialogDescription>
          </DialogHeader>
          {overrideTarget && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
                <div><strong>{overrideTarget.fullName}</strong> · {overrideTarget.familyName}</div>
                <div className="text-muted-foreground">
                  In since {formatTime(overrideTarget.checkedInAt)}
                </div>
                {overrideTarget.hasAlerts && (
                  <div className="mt-2 text-red-700 dark:text-red-300 text-xs">
                    <AlertTriangle className="inline h-3 w-3 mr-1" />
                    Allergy/medical alerts present — see roster row.
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="override-collector">Collector Person ID (optional)</Label>
                <Input
                  id="override-collector"
                  placeholder="leave blank if unknown adult"
                  value={overrideCollector}
                  onChange={(e) => setOverrideCollector(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  If the collector is a known Person, paste their ID. Otherwise leave blank.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="override-note">Note (min 10 chars — mandatory)</Label>
                <Textarea
                  id="override-note"
                  placeholder="e.g. Spoke with primary carer John Smith by phone at 10:42am, he authorised release to his sister Jane."
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                />
              </div>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={overrideConfirmed}
                  onCheckedChange={(v) => setOverrideConfirmed(v === true)}
                />
                <span>
                  I have contacted and confirmed with an authorised carer/guardian that this child
                  may be released to the named collector.
                </span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideTarget(null)} disabled={overrideSubmitting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitOverrideCheckout}
              disabled={overrideSubmitting || !overrideConfirmed || overrideNote.trim().length < 10}
            >
              {overrideSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RosterRow({
  child,
  photoVerificationEnabled,
  canCheckOut,
  canOverride,
  onCheckout,
  onOverride,
}: {
  child: RosterChild;
  photoVerificationEnabled: boolean;
  canCheckOut: boolean;
  canOverride: boolean;
  onCheckout: () => void;
  onOverride: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        {photoVerificationEnabled && child.hasPhoto ? (
          <Avatar className="h-8 w-8">
            <AvatarImage
              src={`/api/people/${child.childPersonId}/photo`}
              alt={child.fullName}
            />
            <AvatarFallback className="text-[10px]">
              {initials(child.fullName)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-[10px]">
              {initials(child.fullName)}
            </AvatarFallback>
          </Avatar>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium leading-tight">{child.fullName}</span>
          <span className="text-xs text-muted-foreground leading-tight">
            age {child.ageYears ?? "?"}
            {child.isVisitor ? " · visitor" : ""}
            {child.dailyCode ? ` · code ${child.dailyCode}` : ""}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm">{child.familyName}</TableCell>
      <TableCell className="hidden lg:table-cell text-sm">
        <div className="flex flex-col leading-tight">
          <span>{child.className ?? "—"}</span>
          <span className="text-xs text-muted-foreground">{child.roomName ?? "—"}</span>
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-sm">{formatTime(child.checkedInAt)}</TableCell>
      <TableCell className="hidden sm:table-cell text-sm">
        <Badge variant="outline" className="text-[10px]">
          {formatElapsed(elapsedMinutes(child.checkedInAt))}
        </Badge>
      </TableCell>
      <TableCell>
        {child.hasAlerts ? (
          <div className="space-y-0.5 max-w-[14rem]">
            <Badge variant="destructive" className="text-[10px] gap-1">
              <AlertTriangle className="h-3 w-3" /> alert
            </Badge>
            {child.allergies && child.allergies.trim().length > 0 && (
              <div className="text-[11px] text-red-700 dark:text-red-300 leading-tight">
                <HeartPulse className="inline h-3 w-3 mr-1 align-text-bottom" />
                Allergies: {child.allergies}
              </div>
            )}
            {child.medicalNotes && child.medicalNotes.trim().length > 0 && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300 leading-tight">
                <BadgeCheck className="inline h-3 w-3 mr-1 align-text-bottom" />
                Medical: {child.medicalNotes}
              </div>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1.5">
          {canCheckOut && (
            <Button size="sm" variant="outline" onClick={onCheckout}>
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Check out</span>
            </Button>
          )}
          {canOverride && (
            <Button size="sm" variant="destructive" onClick={onOverride}>
              <ShieldAlert className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Override</span>
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function SummaryStat({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight
          ? "border-red-300 bg-red-50 dark:bg-red-950/30"
          : "bg-card"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}
