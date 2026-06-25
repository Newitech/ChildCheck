"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Clock,
  Download,
  Loader2,
  Mail,
  Printer,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import { useTerminology } from "@/hooks/use-terminology";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScopeOptions {
  programs: { id: string; name: string; slug: string }[];
  classes: { id: string; name: string; programId: string; programName: string }[];
  rooms: { id: string; name: string; code: string | null }[];
}

interface AttendanceRow {
  date: string;
  programId: string | null;
  programName: string | null;
  classId: string | null;
  className: string | null;
  checkedIn: number;
  checkedOut: number;
  stillIn: number;
}
interface AttendanceResponse {
  rows: AttendanceRow[];
  chart: { date: string; count: number }[];
}

interface HeadcountRow {
  date: string;
  reported: number | null;
  system: number;
  discrepancy: number | null;
}
interface HeadcountResponse {
  rows: HeadcountRow[];
  chart: { date: string; reported: number | null; system: number }[];
}

interface VolunteerHoursRow {
  userId: string;
  name: string;
  role: string;
  sessions: number;
  totalMinutes: number;
}
interface VolunteerHoursResponse {
  rows: VolunteerHoursRow[];
}

interface VisitorRow {
  personId: string;
  name: string;
  firstVisitDate: string | null;
  visitCount: number;
  returned: boolean;
}
interface VisitorResponse {
  rows: VisitorRow[];
}

type WwccFlag = "expired" | "30" | "60" | "90" | "ok";
interface WwccRow {
  personId: string;
  name: string;
  cardType: string;
  status: string;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  flag: WwccFlag;
}
interface WwccResponse {
  rows: WwccRow[];
}

interface Props {
  scopeOptions: ScopeOptions;
  wwccTrackingEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL = "__all__";

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgoIsoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function wwccBadge(flag: WwccFlag): { label: string; variant: "destructive" | "default" | "secondary" | "outline" } {
  switch (flag) {
    case "expired":
      return { label: "Expired", variant: "destructive" };
    case "30":
      return { label: "≤ 30 days", variant: "destructive" };
    case "60":
      return { label: "≤ 60 days", variant: "default" };
    case "90":
      return { label: "≤ 90 days", variant: "secondary" };
    default:
      return { label: "OK", variant: "outline" };
  }
}

// ---------------------------------------------------------------------------
// Email dialog (shared)
// ---------------------------------------------------------------------------

interface EmailDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reportType: string;
  buildHref: () => string;
}

function EmailDialog({ open, onOpenChange, reportType, buildHref }: EmailDialogProps) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject(`${reportType} report — ChildCheck`);
  }, [open, reportType]);

  const send = useCallback(async () => {
    if (!to.trim()) {
      toast.error("Recipient email is required");
      return;
    }
    setSending(true);
    try {
      const url = buildHref();
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const paramObj: Record<string, string> = {};
      params.forEach((v, k) => { paramObj[k] = v; });
      const res = await fetch("/api/admin/reports/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType,
          to: to.trim(),
          subject: subject.trim() || undefined,
          format: "csv",
          params: paramObj,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Report email queued (stub — real SMTP delivery is a future stage).");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [to, subject, reportType, buildHref, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email report</DialogTitle>
          <DialogDescription>
            Email a CSV copy of this report to a recipient. (Real SMTP delivery
            arrives in a future stage — this stub records the request + audit
            entry only.)
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email-to">To</Label>
            <Input
              id="email-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending}>
            {sending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Toolbar (Refresh, CSV, Print, Email)
// ---------------------------------------------------------------------------

interface ToolbarProps {
  buildHref: (format: "json" | "csv") => string;
  printHref: string;
  reportType: string;
  onRefresh: () => void;
  loading: boolean;
  extra?: React.ReactNode;
}

function ReportToolbar({ buildHref, printHref, reportType, onRefresh, loading }: ToolbarProps) {
  const [emailOpen, setEmailOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
        {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
        Refresh
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={buildHref("csv")}>
          <Download className="mr-1.5 h-4 w-4" /> CSV
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={printHref} target="_blank" rel="noreferrer">
          <Printer className="mr-1.5 h-4 w-4" /> Print
        </a>
      </Button>
      <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)}>
        <Mail className="mr-1.5 h-4 w-4" /> Email
      </Button>
      <EmailDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        reportType={reportType}
        buildHref={() => buildHref("csv")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendance report
// ---------------------------------------------------------------------------

function AttendanceReport({ scope }: { scope: ScopeOptions }) {
  const { t } = useTerminology();
  const [programId, setProgramId] = useState<string>(ALL);
  const [classId, setClassId] = useState<string>(ALL);
  const [dateFrom, setDateFrom] = useState<string>(daysAgoIsoDate(29));
  const [dateTo, setDateTo] = useState<string>(todayIsoDate());

  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Class options filtered by selected program.
  const classOptions = useMemo(() => {
    if (programId === ALL) return scope.classes;
    return scope.classes.filter((c) => c.programId === programId);
  }, [scope.classes, programId]);

  // Reset class filter if it's no longer in the filtered list.
  useEffect(() => {
    if (classId !== ALL && !classOptions.some((c) => c.id === classId)) {
      setClassId(ALL);
    }
  }, [classOptions, classId]);

  const buildQuery = useCallback(
    (format: "json" | "csv") => {
      const params = new URLSearchParams();
      if (programId !== ALL) params.set("programId", programId);
      if (classId !== ALL) params.set("classId", classId);
      params.set("dateFrom", dateFrom);
      params.set("dateTo", dateTo);
      if (format === "csv") params.set("format", "csv");
      return params.toString();
    },
    [programId, classId, dateFrom, dateTo],
  );

  const buildHref = useCallback(
    (format: "json" | "csv") => `/api/admin/reports/attendance?${buildQuery(format)}`,
    [buildQuery],
  );
  const printHref = useMemo(
    () => `/admin/reports/print?type=attendance&${buildQuery("json")}`,
    [buildQuery],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildHref("json"), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AttendanceResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [buildHref]);

  useEffect(() => {
    load();
  }, [load]);

  const chartConfig: ChartConfig = {
    count: { label: "Check-ins", color: "var(--chart-1)" },
  };

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Attendance by program / class / date</CardTitle>
            <CardDescription>
              Daily check-in counts grouped by {t("group").toLowerCase()} &amp;{" "}
              {t("room").toLowerCase()}. Filter by program or class.
            </CardDescription>
          </div>
          <ReportToolbar
            buildHref={buildHref}
            printHref={printHref}
            reportType="attendance"
            onRefresh={load}
            loading={loading}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Program</Label>
            <Select value={programId} onValueChange={setProgramId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="All programs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All programs</SelectItem>
                {scope.programs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("group")}</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger className="w-full"><SelectValue placeholder={`All ${t("group_plural").toLowerCase()}`} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All {t("group_plural").toLowerCase()}</SelectItem>
                {classOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.programName})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="att-from">From</Label>
            <Input id="att-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="att-to">To</Label>
            <Input id="att-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}
        {data && data.chart.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <BarChart3 className="h-4 w-4" /> Daily check-ins
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[240px] w-full">
                <BarChart data={data.chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={24}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}
        <div className="rounded-md border max-h-96 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Program</TableHead>
                <TableHead>{t("group")}</TableHead>
                <TableHead className="text-right">Checked in</TableHead>
                <TableHead className="text-right">Checked out</TableHead>
                <TableHead className="text-right">Still in care</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data && data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    No check-ins in the selected range.
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.map((r, i) => (
                <TableRow key={`${r.date}-${r.programId ?? ""}-${r.classId ?? ""}-${i}`}>
                  <TableCell className="font-mono text-xs">{r.date}</TableCell>
                  <TableCell>{r.programName ?? "—"}</TableCell>
                  <TableCell>{r.className ?? "—"}</TableCell>
                  <TableCell className="text-right">{r.checkedIn}</TableCell>
                  <TableCell className="text-right">{r.checkedOut}</TableCell>
                  <TableCell className="text-right">
                    {r.stillIn > 0 ? (
                      <Badge variant="secondary">{r.stillIn}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Headcount trends
// ---------------------------------------------------------------------------

function HeadcountTrends({ scope }: { scope: ScopeOptions }) {
  const { t } = useTerminology();
  const [roomId, setRoomId] = useState<string>(ALL);
  const [classId, setClassId] = useState<string>(ALL);
  const [dateFrom, setDateFrom] = useState<string>(daysAgoIsoDate(29));
  const [dateTo, setDateTo] = useState<string>(todayIsoDate());

  const [data, setData] = useState<HeadcountResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildQuery = useCallback(
    (format: "json" | "csv") => {
      const params = new URLSearchParams();
      if (roomId !== ALL) params.set("roomId", roomId);
      if (classId !== ALL) params.set("classId", classId);
      params.set("dateFrom", dateFrom);
      params.set("dateTo", dateTo);
      if (format === "csv") params.set("format", "csv");
      return params.toString();
    },
    [roomId, classId, dateFrom, dateTo],
  );

  const buildHref = useCallback(
    (format: "json" | "csv") => `/api/admin/reports/headcount-trends?${buildQuery(format)}`,
    [buildQuery],
  );
  const printHref = useMemo(
    () => `/admin/reports/print?type=headcount-trends&${buildQuery("json")}`,
    [buildQuery],
  );

  const load = useCallback(async () => {
    if (roomId === ALL && classId === ALL) {
      setError(`Select a ${t("room").toLowerCase()} or ${t("group").toLowerCase()} to compare headcounts.`);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildHref("json"), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as HeadcountResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [buildHref, roomId, classId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const chartConfig: ChartConfig = {
    reported: { label: "Reported", color: "var(--chart-2)" },
    system: { label: "System", color: "var(--chart-1)" },
  };

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Headcount trends</CardTitle>
            <CardDescription>
              Compares manually-reported headcounts against the system count of
              checked-in children for the same scope &amp; day. Discrepancies
              flag potentially missed check-ins or wandering children.
            </CardDescription>
          </div>
          <ReportToolbar
            buildHref={buildHref}
            printHref={printHref}
            reportType="headcount-trends"
            onRefresh={load}
            loading={loading}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("room")}</Label>
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger className="w-full"><SelectValue placeholder={`Any ${t("room").toLowerCase()}`} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any {t("room").toLowerCase()}</SelectItem>
                {scope.rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("group")}</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger className="w-full"><SelectValue placeholder={`Any ${t("group").toLowerCase()}`} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any {t("group").toLowerCase()}</SelectItem>
                {scope.classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.programName})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="hc-from">From</Label>
            <Input id="hc-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="hc-to">To</Label>
            <Input id="hc-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}
        {data && data.chart.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Activity className="h-4 w-4" /> Reported vs system
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[240px] w-full">
                <LineChart data={data.chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={24}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    type="monotone"
                    dataKey="reported"
                    stroke="var(--color-reported)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="system"
                    stroke="var(--color-system)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}
        <div className="rounded-md border max-h-96 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Reported</TableHead>
                <TableHead className="text-right">System</TableHead>
                <TableHead className="text-right">Discrepancy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data && data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    No headcount entries in the selected range.
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.map((r) => (
                <TableRow key={r.date}>
                  <TableCell className="font-mono text-xs">{r.date}</TableCell>
                  <TableCell className="text-right">{r.reported ?? "—"}</TableCell>
                  <TableCell className="text-right">{r.system}</TableCell>
                  <TableCell className="text-right">
                    {r.discrepancy == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : r.discrepancy === 0 ? (
                      <Badge variant="outline">0</Badge>
                    ) : (
                      <Badge variant={r.discrepancy !== 0 ? "destructive" : "outline"}>
                        {r.discrepancy > 0 ? "+" : ""}{r.discrepancy}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Volunteer hours
// ---------------------------------------------------------------------------

function VolunteerHours() {
  const [dateFrom, setDateFrom] = useState<string>(daysAgoIsoDate(29));
  const [dateTo, setDateTo] = useState<string>(todayIsoDate());

  const [data, setData] = useState<VolunteerHoursResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildQuery = useCallback(
    (format: "json" | "csv") => {
      const params = new URLSearchParams();
      params.set("dateFrom", dateFrom);
      params.set("dateTo", dateTo);
      if (format === "csv") params.set("format", "csv");
      return params.toString();
    },
    [dateFrom, dateTo],
  );

  const buildHref = useCallback(
    (format: "json" | "csv") => `/api/admin/reports/volunteer-hours?${buildQuery(format)}`,
    [buildQuery],
  );
  const printHref = useMemo(
    () => `/admin/reports/print?type=volunteer-hours&${buildQuery("json")}`,
    [buildQuery],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildHref("json"), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as VolunteerHoursResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [buildHref]);

  useEffect(() => {
    load();
  }, [load]);

  const totalMinutes = data?.rows.reduce((s, r) => s + r.totalMinutes, 0) ?? 0;
  const totalSessions = data?.rows.reduce((s, r) => s + r.sessions, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Volunteer hours</CardTitle>
            <CardDescription>
              For users with the Volunteer or Teacher role, sums the duration of
              each check-in/out session they performed. Incomplete sessions
              (still checked in) contribute 0 minutes.
            </CardDescription>
          </div>
          <ReportToolbar
            buildHref={buildHref}
            printHref={printHref}
            reportType="volunteer-hours"
            onRefresh={load}
            loading={loading}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="vh-from">From</Label>
            <Input id="vh-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="vh-to">To</Label>
            <Input id="vh-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}
        {data && data.rows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Volunteers</div>
              <div className="text-2xl font-semibold">{data.rows.length}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Sessions</div>
              <div className="text-2xl font-semibold">{totalSessions}</div>
            </div>
            <div className="rounded-md border p-3 col-span-2 sm:col-span-1">
              <div className="text-xs text-muted-foreground">Total time</div>
              <div className="text-2xl font-semibold">{formatMinutes(totalMinutes)}</div>
            </div>
          </div>
        )}
        <div className="rounded-md border max-h-96 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Volunteer</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Total time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data && data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    No volunteer sessions in the selected range.
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.map((r) => (
                <TableRow key={r.userId}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    {r.role.split(",").map((role) => (
                      <Badge key={role} variant="secondary" className="mr-1 text-[10px]">{role}</Badge>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">{r.sessions}</TableCell>
                  <TableCell className="text-right font-mono">{formatMinutes(r.totalMinutes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Visitors follow-up
// ---------------------------------------------------------------------------

function VisitorsReport() {
  const [dateFrom, setDateFrom] = useState<string>(daysAgoIsoDate(89));
  const [dateTo, setDateTo] = useState<string>(todayIsoDate());

  const [data, setData] = useState<VisitorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildQuery = useCallback(
    (format: "json" | "csv") => {
      const params = new URLSearchParams();
      params.set("dateFrom", dateFrom);
      params.set("dateTo", dateTo);
      if (format === "csv") params.set("format", "csv");
      return params.toString();
    },
    [dateFrom, dateTo],
  );

  const buildHref = useCallback(
    (format: "json" | "csv") => `/api/admin/reports/visitors?${buildQuery(format)}`,
    [buildQuery],
  );
  const printHref = useMemo(
    () => `/admin/reports/print?type=visitors&${buildQuery("json")}`,
    [buildQuery],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildHref("json"), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as VisitorResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [buildHref]);

  useEffect(() => {
    load();
  }, [load]);

  const returnedCount = data?.rows.filter((r) => r.returned).length ?? 0;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>First-time / visitor follow-up</CardTitle>
            <CardDescription>
              Every person flagged as a visitor, their first visit in the range,
              total visits, and whether they returned (≥ 2 visits all-time).
            </CardDescription>
          </div>
          <ReportToolbar
            buildHref={buildHref}
            printHref={printHref}
            reportType="visitors"
            onRefresh={load}
            loading={loading}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="vs-from">From</Label>
            <Input id="vs-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="vs-to">To</Label>
            <Input id="vs-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}
        {data && data.rows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Visitors</div>
              <div className="text-2xl font-semibold">{data.rows.length}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Returned</div>
              <div className="text-2xl font-semibold">{returnedCount}</div>
            </div>
            <div className="rounded-md border p-3 col-span-2 sm:col-span-1">
              <div className="text-xs text-muted-foreground">Follow-up rate</div>
              <div className="text-2xl font-semibold">
                {data.rows.length > 0
                  ? `${Math.round((returnedCount / data.rows.length) * 100)}%`
                  : "—"}
              </div>
            </div>
          </div>
        )}
        <div className="rounded-md border max-h-96 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>First visit</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">Returned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data && data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    No visitors in the selected range.
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.map((r) => (
                <TableRow key={r.personId}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.firstVisitDate ?? "—"}</TableCell>
                  <TableCell className="text-right">{r.visitCount}</TableCell>
                  <TableCell className="text-right">
                    {r.returned ? (
                      <Badge variant="default">Yes</Badge>
                    ) : (
                      <Badge variant="outline">No</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WWCC expiry
// ---------------------------------------------------------------------------

function WwccExpiryReport({ wwccTrackingEnabled }: { wwccTrackingEnabled: boolean }) {
  const [withinDays, setWithinDays] = useState<string>("90");

  const [data, setData] = useState<WwccResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildQuery = useCallback(
    (format: "json" | "csv") => {
      const params = new URLSearchParams();
      params.set("withinDays", withinDays);
      if (format === "csv") params.set("format", "csv");
      return params.toString();
    },
    [withinDays],
  );

  const buildHref = useCallback(
    (format: "json" | "csv") => `/api/admin/reports/wwcc-expiry?${buildQuery(format)}`,
    [buildQuery],
  );
  const printHref = useMemo(
    () => `/admin/reports/print?type=wwcc-expiry&${buildQuery("json")}`,
    [buildQuery],
  );

  const load = useCallback(async () => {
    if (!wwccTrackingEnabled) {
      setError("Working-with-Children tracking is disabled. Enable it in Settings → Feature flags.");
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildHref("json"), { cache: "no-store" });
      if (res.status === 404) {
        setError("Working-with-Children tracking is disabled. Enable it in Settings → Feature flags.");
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as WwccResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [buildHref, wwccTrackingEnabled]);

  useEffect(() => {
    load();
  }, [load]);

  const expiredCount = data?.rows.filter((r) => r.flag === "expired").length ?? 0;
  const upcomingCount = data?.rows.filter((r) => r.flag !== "expired" && r.flag !== "ok").length ?? 0;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Working-with-Children card expiry</CardTitle>
            <CardDescription>
              Every WWCC / Blue Card on file, sorted by soonest-expiring. Cards
              flagged expired (red) and expiring within 30 / 60 / 90 days.
            </CardDescription>
          </div>
          <ReportToolbar
            buildHref={buildHref}
            printHref={printHref}
            reportType="wwcc-expiry"
            onRefresh={load}
            loading={loading}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Window</Label>
            <Select value={withinDays} onValueChange={setWithinDays}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Next 30 days</SelectItem>
                <SelectItem value="60">Next 60 days</SelectItem>
                <SelectItem value="90">Next 90 days</SelectItem>
                <SelectItem value="180">Next 180 days</SelectItem>
                <SelectItem value="365">Next year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border p-3 flex flex-col justify-center">
            <div className="text-xs text-muted-foreground">Expired</div>
            <div className="text-2xl font-semibold text-destructive">{expiredCount}</div>
          </div>
          <div className="rounded-md border p-3 flex flex-col justify-center">
            <div className="text-xs text-muted-foreground">Expiring soon</div>
            <div className="text-2xl font-semibold">{upcomingCount}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="text-sm text-destructive flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}
        <div className="rounded-md border max-h-96 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Card type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Flag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data && data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    No WWCC cards on file.
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.map((r) => {
                const b = wwccBadge(r.flag);
                return (
                  <TableRow key={`${r.personId}-${r.cardType}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.cardType}</TableCell>
                    <TableCell>{r.status}</TableCell>
                    <TableCell className="font-mono text-xs">{formatDate(r.expiresAt)}</TableCell>
                    <TableCell className="text-right">
                      {r.daysUntilExpiry == null ? "—" : r.daysUntilExpiry}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={b.variant}>{b.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top-level dashboard
// ---------------------------------------------------------------------------

export function ReportsDashboard({ scopeOptions, wwccTrackingEnabled }: Props) {
  const { t } = useTerminology();

  return (
    <Tabs defaultValue="attendance" className="w-full">
      <TabsList className="flex h-auto flex-wrap gap-1 bg-muted/50 p-1">
        <TabsTrigger value="attendance" className="gap-1.5">
          <CalendarDays className="h-4 w-4" /> Attendance
        </TabsTrigger>
        <TabsTrigger value="headcount" className="gap-1.5">
          <Activity className="h-4 w-4" /> Headcount trends
        </TabsTrigger>
        <TabsTrigger value="volunteer" className="gap-1.5">
          <Clock className="h-4 w-4" /> Volunteer hours
        </TabsTrigger>
        <TabsTrigger value="visitors" className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Visitors
        </TabsTrigger>
        <TabsTrigger value="wwcc" className="gap-1.5">
          <ClipboardList className="h-4 w-4" /> WWCC expiry
        </TabsTrigger>
      </TabsList>

      <TabsContent value="attendance" className="mt-4">
        <AttendanceReport scope={scopeOptions} />
      </TabsContent>
      <TabsContent value="headcount" className="mt-4">
        <HeadcountTrends scope={scopeOptions} />
      </TabsContent>
      <TabsContent value="volunteer" className="mt-4">
        <VolunteerHours />
      </TabsContent>
      <TabsContent value="visitors" className="mt-4">
        <VisitorsReport />
      </TabsContent>
      <TabsContent value="wwcc" className="mt-4">
        <WwccExpiryReport wwccTrackingEnabled={wwccTrackingEnabled} />
      </TabsContent>
    </Tabs>
  );
}
