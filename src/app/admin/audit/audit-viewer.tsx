"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  ArrowLeft,
  Filter,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

interface AuditActor {
  username: string;
  name: string;
}

interface AuditRow {
  id: string;
  actorUserId: string | null;
  actor: AuditActor | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: string | null;
  ip: string | null;
  createdAt: string;
  prevHash: string | null;
  hash: string | null;
  hashShort: string | null;
  prevHashShort: string | null;
  tamperStatus: "unhashed" | "ok" | "tampered";
}

interface AuditResponse {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface VerifyResult {
  ok: boolean;
  brokenAt?: string | null;
  reason?: string | null;
  totalRows: number;
  verifiedRows: number;
  skippedUnhashed: number;
}

const PAGE_SIZE = 25;

// Sentinel value used for the "All actions" option in the Select. Radix Select
// doesn't allow an empty-string value on SelectItem (it reserves "" for
// "clear the selection"), so we use "__all__" internally and translate back
// to "" when building the query string.
const ALL_ACTIONS = "__all__";

const ACTION_OPTIONS = [
  ALL_ACTIONS,
  "user.login",
  "user.signout",
  "kiosk.search",
  "guardian.pin_verify_ok",
  "guardian.pin_verify_failed",
  "guardian.pin_rate_limited",
  "flag.update",
  "person.photo.upload",
  "person.photo.remove",
  "blacklist.add",
  "branding.logo",
  "key.rotation",
];

export function AuditLogViewer() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<string>(ALL_ACTIONS);
  const [entity, setEntity] = useState("");
  const [entityId, setEntityId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [q, setQ] = useState("");

  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (action && action !== ALL_ACTIONS) params.set("action", action);
      if (entity) params.set("entity", entity);
      if (entityId) params.set("entityId", entityId);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (q) params.set("q", q);
      const res = await fetch(`/api/admin/audit?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 401) {
          setError("You are not authorized to view the audit log.");
        } else {
          setError(`Failed to load audit log (HTTP ${res.status}).`);
        }
        return;
      }
      const json = (await res.json()) as AuditResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [page, action, entity, entityId, dateFrom, dateTo, q]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const runVerify = useCallback(async () => {
    setVerifying(true);
    try {
      const res = await fetch("/api/admin/audit/verify", { cache: "no-store" });
      if (!res.ok) {
        setError(`Verify failed (HTTP ${res.status}).`);
        return;
      }
      const json = (await res.json()) as VerifyResult;
      setVerify(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setVerifying(false);
    }
  }, []);

  const applyFilters = () => {
    setPage(1);
    void fetchData();
  };

  const resetFilters = () => {
    setAction(ALL_ACTIONS);
    setEntity("");
    setEntityId("");
    setDateFrom("");
    setDateTo("");
    setQ("");
    setPage(1);
  };

  const totalRows = data?.total ?? 0;
  const startIdx = totalRows === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(totalRows, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Fingerprint className="h-6 w-6 text-primary" /> Audit log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tamper-evident, hash-chained record of every sensitive action.
            Verify the chain to detect any in-place edits, insertions or
            deletions.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Admin home
          </Link>
        </Button>
      </div>

      {/* Verify banner */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Chain integrity
          </CardTitle>
          <CardDescription>
            Walk every audit row oldest→newest, recompute each SHA-256 hash,
            and flag the first row that fails (tampered row, or a broken
            prevHash link from an inserted/deleted row).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => void runVerify()}
            disabled={verifying}
            size="sm"
          >
            {verifying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…
              </>
            ) : (
              <>
                <ShieldCheck className="mr-2 h-4 w-4" /> Verify chain integrity
              </>
            )}
          </Button>

          {verify && (
            <div>
              {verify.ok ? (
                <Alert className="border-emerald-500/40 bg-emerald-500/10">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <AlertTitle className="text-emerald-700 dark:text-emerald-400">
                    Chain intact ✓
                  </AlertTitle>
                  <AlertDescription className="text-emerald-700 dark:text-emerald-400">
                    Verified {verify.verifiedRows} hashed row
                    {verify.verifiedRows === 1 ? "" : "s"}
                    {verify.skippedUnhashed > 0 && (
                      <>
                        {" "}({verify.skippedUnhashed} pre-Stage-16 row
                        {verify.skippedUnhashed === 1 ? "" : "s"} skipped — no
                        hash).
                      </>
                    )}
                    {" "}No tampering detected.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Tampering detected</AlertTitle>
                  <AlertDescription className="space-y-1">
                    <div>
                      First broken row:{" "}
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {verify.brokenAt ?? "unknown"}
                      </code>
                    </div>
                    {verify.reason && <div>Reason: {verify.reason}</div>}
                    <div className="text-xs opacity-80">
                      Verified {verify.verifiedRows} row
                      {verify.verifiedRows === 1 ? "" : "s"} before failure ·{" "}
                      {verify.skippedUnhashed} unhashed row
                      {verify.skippedUnhashed === 1 ? "" : "s"} skipped.
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="f-action" className="text-xs">Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="f-action">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a === ALL_ACTIONS ? "All actions" : a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-entity" className="text-xs">Entity</Label>
            <Input
              id="f-entity"
              placeholder="e.g. Person, Family"
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-entityId" className="text-xs">Entity ID</Label>
            <Input
              id="f-entityId"
              placeholder="exact id"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-q" className="text-xs">Details contains</Label>
            <Input
              id="f-q"
              placeholder="free text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-from" className="text-xs">From</Label>
            <Input
              id="f-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-to" className="text-xs">To</Label>
            <Input
              id="f-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-2 flex items-end gap-2">
            <Button onClick={applyFilters} size="sm">
              <Search className="mr-1.5 h-4 w-4" /> Apply
            </Button>
            <Button onClick={resetFilters} variant="outline" size="sm">
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Entries</CardTitle>
          <CardDescription>
            {loading
              ? "Loading…"
              : data
                ? `Showing ${startIdx}–${endIdx} of ${totalRows}`
                : "—"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">When</TableHead>
                  <TableHead className="w-32">Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="w-28">Tamper</TableHead>
                  <TableHead className="w-32">Hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                )}
                {!loading && data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No audit entries match these filters.
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  data &&
                  data.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatTime(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">{row.action}</code>
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.actor ? (
                          <div>
                            <div className="font-medium">{row.actor.name}</div>
                            <div className="text-muted-foreground">@{row.actor.username}</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.entity ? (
                          <div>
                            <div>{row.entity}</div>
                            {row.entityId && (
                              <div className="text-muted-foreground truncate max-w-[12rem]">
                                {row.entityId}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <DetailCell details={row.details} />
                      </TableCell>
                      <TableCell>
                        <TamperBadge status={row.tamperStatus} />
                      </TableCell>
                      <TableCell>
                        {row.hashShort ? (
                          <code
                            className="text-[10px] block max-w-[10rem] truncate text-muted-foreground"
                            title={row.hash ?? ""}
                          >
                            {row.hashShort}…
                          </code>
                        ) : (
                          <span className="text-muted-foreground text-xs">null</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-xs text-muted-foreground">
                Page {data.page} of {data.totalPages}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TamperBadge({
  status,
}: {
  status: "unhashed" | "ok" | "tampered";
}) {
  if (status === "ok") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
        <ShieldCheck className="h-3 w-3 mr-1" /> OK
      </Badge>
    );
  }
  if (status === "tampered") {
    return (
      <Badge variant="destructive">
        <ShieldAlert className="h-3 w-3 mr-1" /> Tampered
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      unhashed
    </Badge>
  );
}

function DetailCell({ details }: { details: string | null }) {
  if (!details) {
    return <span className="text-muted-foreground">—</span>;
  }

  // Parse the JSON outside of any JSX so we don't construct JSX inside a
  // try/catch (which the lint rule react-hooks/error-boundaries forbids).
  let parsed: Record<string, unknown> | null = null;
  try {
    const obj = JSON.parse(details) as Record<string, unknown>;
    parsed = obj;
  } catch {
    parsed = null;
  }

  if (parsed === null) {
    return <span className="truncate block max-w-md">{details}</span>;
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    return <span className="text-muted-foreground">{"{}"}</span>;
  }
  return (
    <div className="space-y-0.5 max-w-md">
      {entries.slice(0, 4).map(([k, v]) => (
        <div key={k} className="flex gap-1">
          <span className="text-muted-foreground">{k}:</span>
          <span className="truncate">
            {typeof v === "string" ? v : JSON.stringify(v)}
          </span>
        </div>
      ))}
      {entries.length > 4 && (
        <div className="text-muted-foreground text-[10px]">
          +{entries.length - 4} more
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} ${time}`;
}
