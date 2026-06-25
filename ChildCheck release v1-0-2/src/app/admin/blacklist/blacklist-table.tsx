"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Ban,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface BlacklistRow {
  id: string;
  childId: string | null;
  familyId: string | null;
  personId: string | null;
  collectorName: string | null;
  collectorDescription: string | null;
  reason: string;
  severity: string;
  createdAt: string;
  child: { id: string; name: string } | null;
  family: { id: string; familyName: string } | null;
  person: { id: string; name: string } | null;
}

interface FamilyOption {
  id: string;
  familyName: string;
}

interface ChildOption {
  id: string;
  name: string;
}

/**
 * Filterable, paginated table of all BlacklistEntry rows. Supports filtering
 * by family, child, or severity. Used by the Security role for at-a-glance
 * situational awareness.
 */
export function BlacklistTable() {
  const { t } = useTerminology();
  const [items, setItems] = useState<BlacklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  // Filters
  const [families, setFamilies] = useState<FamilyOption[]>([]);
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [familyId, setFamilyId] = useState<string>("__all__");
  const [childId, setChildId] = useState<string>("__all__");
  const [severity, setSeverity] = useState<string>("__all__");

  // Sentinel value used for the "All …" options in the filter dropdowns.
  // Radix UI's Select.Item forbids empty-string values, so we use "__all__"
  // and translate it back to "no filter" in `load()` and `clearFilters()`.
  const ALL = "__all__";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (familyId !== ALL) params.set("familyId", familyId);
      if (childId !== ALL) params.set("childId", childId);
      if (severity !== ALL) params.set("severity", severity);
      const url = `/api/admin/blacklist${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: BlacklistRow[] };
      setItems(data.items);
    } catch (e) {
      toast.error("Failed to load blacklist", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [familyId, childId, severity]);

  // Load filter options (families + children for pickers).
  useEffect(() => {
    void (async () => {
      try {
        const [fam, peo] = await Promise.all([
          fetch(`/api/admin/families?pageSize=100`, { cache: "no-store" }),
          fetch(`/api/admin/people?personType=Child&pageSize=100`, {
            cache: "no-store",
          }),
        ]);
        if (fam.ok) {
          const d = (await fam.json()) as {
            items: { id: string; familyName: string }[];
          };
          setFamilies(d.items);
        }
        if (peo.ok) {
          const d = (await peo.json()) as {
            items: {
              id: string;
              firstName: string;
              lastName: string;
              preferredName: string | null;
            }[];
          };
          setChildren(
            d.items.map((p) => ({
              id: p.id,
              name: `${p.firstName} ${p.lastName}`,
            })),
          );
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemove = async (id: string) => {
    setRemoving(id);
    try {
      const res = await fetch(`/api/admin/blacklist/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Blacklist entry removed");
      await load();
    } catch (e) {
      toast.error("Failed to remove entry", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setRemoving(null);
    }
  };

  const clearFilters = () => {
    setFamilyId(ALL);
    setChildId(ALL);
    setSeverity(ALL);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">All blacklist entries</CardTitle>
        <CardDescription>
          <strong className="text-destructive">Blocked</strong> = hard stop,
          never allow even if a primary carer.{" "}
          <strong className="text-amber-700">Flag</strong> = warn operator,
          supervisor override possible at checkout.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">{t("family")}</Label>
            <Select value={familyId} onValueChange={setFamilyId}>
              <SelectTrigger aria-label="Filter by family">
                <SelectValue placeholder="All families" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All families</SelectItem>
                {families.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.familyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("child")}</Label>
            <Select value={childId} onValueChange={setChildId}>
              <SelectTrigger aria-label="Filter by child">
                <SelectValue placeholder="All children" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All children</SelectItem>
                {children.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger aria-label="Filter by severity">
                <SelectValue placeholder="All severities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All severities</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
                <SelectItem value="flag">Flag</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            disabled={familyId === ALL && childId === ALL && severity === ALL}
          >
            Clear filters
          </Button>
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No blacklist entries match the current filters.
          </p>
        ) : (
          <div className="rounded-md border max-h-[60vh] overflow-y-auto scroll-thin">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Collector</TableHead>
                  <TableHead className="w-[100px]">Severity</TableHead>
                  <TableHead className="w-[180px]">Scope</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-[140px]">Added</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      {e.person ? (
                        <Link
                          href={`/admin/people/${e.person.id}`}
                          className="hover:underline"
                        >
                          {e.person.name}
                        </Link>
                      ) : (
                        (e.collectorName ?? "Unknown")
                      )}
                      {e.collectorDescription && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2">
                          {e.collectorDescription}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {e.severity === "blocked" ? (
                        <Badge variant="destructive" className="text-[10px]">
                          <Ban className="h-3 w-3 mr-1" /> Blocked
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-amber-100 text-amber-900 border-amber-300"
                        >
                          <TriangleAlert className="h-3 w-3 mr-1" /> Flag
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {e.child ? (
                        <Link
                          href={`/admin/people/${e.child.id}`}
                          className="text-sm hover:underline"
                        >
                          {e.child.name}
                        </Link>
                      ) : e.family ? (
                        <Link
                          href={`/admin/families/${e.family.id}`}
                          className="text-sm hover:underline"
                        >
                          {e.family.familyName} (whole)
                        </Link>
                      ) : (
                        <span className="text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{e.reason}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove entry"
                        disabled={removing === e.id}
                        onClick={() => void handleRemove(e.id)}
                        className="text-destructive"
                      >
                        {removing === e.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
