"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Ban,
  Loader2,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

interface ChildOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface PersonSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  personType: string;
  email: string | null;
}

interface Props {
  familyId: string;
  familyName: string;
  /** Children of this family — used to pick a specific child target. */
  childMembers: ChildOption[];
  /** When false, Add/Remove controls are hidden (read-only). */
  canEdit: boolean;
}

type TargetMode = "family" | "child";
type CollectorMode = "person" | "freetext";

/**
 * Dedicated "Blacklist" section for the family detail page (Stage 4).
 *
 * Severity semantics surfaced explicitly in the UI:
 *   - "blocked" = hard stop, never allow even if collector is a primary carer.
 *   - "flag"    = warn the operator; a supervisor can override at checkout
 *                 (override flow wired in Stage 8).
 */
export function FamilyBlacklistSection({
  familyId,
  familyName,
  childMembers,
  canEdit,
}: Props) {
  const { t } = useTerminology();
  const [items, setItems] = useState<BlacklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/blacklist?familyId=${encodeURIComponent(familyId)}`,
        { cache: "no-store" },
      );
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
  }, [familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemove = async (id: string) => {
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
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-destructive">
          <Ban className="h-4 w-4" /> Blacklist
        </CardTitle>
        <CardDescription>
          Persons blocked from collecting {t("child_plural").toLowerCase()} in{" "}
          {familyName}. <strong className="text-destructive">Blocked</strong> =
          hard stop (never allow, even if a primary carer).{" "}
          <strong className="text-amber-700">Flag</strong> = warn operator,
          supervisor override possible at checkout.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground flex items-center">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No blacklist entries for this {t("family").toLowerCase()}.
          </p>
        ) : (
          <ul className="space-y-2 max-h-96 overflow-y-auto scroll-thin">
            {items.map((e) => (
              <li
                key={e.id}
                className="rounded-md border p-3 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {e.person ? (
                          <Link
                            href={`/admin/people/${e.person.id}`}
                            className="hover:underline"
                          >
                            {e.person.name}
                          </Link>
                        ) : (
                          (e.collectorName ?? "Unknown collector")
                        )}
                      </span>
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
                      <Badge variant="outline" className="text-[10px]">
                        {e.child
                          ? `Child: ${e.child.name}`
                          : e.family
                            ? `Whole ${t("family").toLowerCase()}`
                            : "—"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      <span className="text-foreground">Reason:</span> {e.reason}
                    </p>
                    {e.collectorDescription && (
                      <p className="text-xs text-muted-foreground">
                        Description: {e.collectorDescription}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Added {new Date(e.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {canEdit && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove blacklist entry"
                          className="text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Remove this blacklist entry?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            The collector will no longer be blocked from
                            collecting. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => void handleRemove(e.id)}
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="mr-1.5 h-4 w-4" /> Add blacklist entry
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[560px]">
              <DialogHeader>
                <DialogTitle>Add blacklist entry</DialogTitle>
                <DialogDescription>
                  Block or flag a collector for {familyName}.
                </DialogDescription>
              </DialogHeader>
              <AddBlacklistForm
                familyId={familyId}
                familyName={familyName}
                childMembers={childMembers}
                onDone={() => {
                  setAddOpen(false);
                  void load();
                }}
              />
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}

interface AddFormProps {
  familyId: string;
  familyName: string;
  childMembers: ChildOption[];
  onDone: () => void;
}

function AddBlacklistForm({ familyId, familyName, childMembers, onDone }: AddFormProps) {
  const { t } = useTerminology();
  const [targetMode, setTargetMode] = useState<TargetMode>("family");
  const [targetChildId, setTargetChildId] = useState<string>("");

  const [collectorMode, setCollectorMode] = useState<CollectorMode>("freetext");
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PersonSearchResult[]>([]);
  const [personId, setPersonId] = useState<string>("");

  const [collectorName, setCollectorName] = useState("");
  const [collectorDescription, setCollectorDescription] = useState("");
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState<"blocked" | "flag">("blocked");
  const [saving, setSaving] = useState(false);

  // Default target child: first child if any.
  useEffect(() => {
    if (targetMode === "child" && !targetChildId && childMembers.length > 0) {
      setTargetChildId(childMembers[0].id);
    }
  }, [targetMode, targetChildId, childMembers]);

  useEffect(() => {
    if (collectorMode !== "person") return;
    if (!searchQ.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const h = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/people?q=${encodeURIComponent(searchQ)}&pageSize=20`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { items: PersonSearchResult[] };
        setSearchResults(data.items);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(h);
  }, [searchQ, collectorMode]);

  const canSubmit = useMemo(() => {
    if (targetMode === "child" && !targetChildId) return false;
    if (collectorMode === "person" && !personId) return false;
    if (collectorMode === "freetext" && !collectorName.trim()) return false;
    if (!reason.trim()) return false;
    return true;
  }, [targetMode, targetChildId, collectorMode, personId, collectorName, reason]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        severity,
        reason: reason.trim(),
      };
      if (targetMode === "child") {
        payload.childId = targetChildId;
      } else {
        payload.familyId = familyId;
      }
      if (collectorMode === "person") {
        payload.personId = personId;
      } else {
        payload.collectorName = collectorName.trim();
        if (collectorDescription.trim()) {
          payload.collectorDescription = collectorDescription.trim();
        }
      }
      const res = await fetch(`/api/admin/blacklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Blacklist entry added");
      onDone();
    } catch (e) {
      toast.error("Failed to add entry", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Target */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Target (who is this collector blocked from collecting?)
        </Label>
        <Select
          value={targetMode}
          onValueChange={(v) => setTargetMode(v as TargetMode)}
        >
          <SelectTrigger aria-label="Target mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="family">
              Whole {t("family").toLowerCase()} (any {t("child").toLowerCase()} in {familyName})
            </SelectItem>
            <SelectItem value="child">A specific child</SelectItem>
          </SelectContent>
        </Select>
        {targetMode === "child" && (
          <>
            {childMembers.length === 0 ? (
              <p className="text-xs text-destructive">
                This family has no children — add a child member first.
              </p>
            ) : (
              <Select value={targetChildId} onValueChange={setTargetChildId}>
                <SelectTrigger aria-label="Target child">
                  <SelectValue placeholder="Pick a child…" />
                </SelectTrigger>
                <SelectContent>
                  {childMembers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        )}
      </div>

      {/* Collector */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Collector (who is being blocked?)
        </Label>
        <Select
          value={collectorMode}
          onValueChange={(v) => setCollectorMode(v as CollectorMode)}
        >
          <SelectTrigger aria-label="Collector mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="freetext">
              Free-text description (unknown person)
            </SelectItem>
            <SelectItem value="person">A known Person record</SelectItem>
          </SelectContent>
        </Select>

        {collectorMode === "freetext" ? (
          <div className="space-y-2">
            <Input
              placeholder="Collector name (e.g. Unknown male ~40s)"
              value={collectorName}
              onChange={(e) => setCollectorName(e.target.value)}
              maxLength={160}
            />
            <Textarea
              placeholder="Identifying description (optional) — e.g. tall, beard, last seen driving a white ute"
              value={collectorDescription}
              onChange={(e) => setCollectorDescription(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              placeholder="Search people by name, email, phone…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searching && (
              <p className="text-xs text-muted-foreground flex items-center">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Searching…
              </p>
            )}
            {searchResults.length > 0 && (
              <ul className="border rounded-md divide-y max-h-48 overflow-y-auto scroll-thin">
                {searchResults.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 p-2 text-sm hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {p.firstName} {p.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.personType}
                        {p.email ? ` · ${p.email}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={personId === p.id ? "default" : "outline"}
                      onClick={() => setPersonId(p.id)}
                    >
                      {personId === p.id ? "Selected" : "Select"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {personId && (
              <p className="text-xs text-emerald-700">
                Selected:{" "}
                {searchResults.find((p) => p.id === personId)?.firstName}{" "}
                {searchResults.find((p) => p.id === personId)?.lastName}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Reason + severity */}
      <div className="space-y-2">
        <Label htmlFor="bl-reason">Reason</Label>
        <Textarea
          id="bl-reason"
          placeholder="e.g. Restraining order, non-custodial parent, court order…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={2000}
        />
      </div>
      <div className="space-y-2">
        <Label>Severity</Label>
        <Select
          value={severity}
          onValueChange={(v) => setSeverity(v as "blocked" | "flag")}
        >
          <SelectTrigger aria-label="Severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="blocked">
              Blocked — hard stop, never allow
            </SelectItem>
            <SelectItem value="flag">
              Flag — warn operator, supervisor override possible
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DialogFooter>
        <Button onClick={() => void handleSubmit()} disabled={!canSubmit || saving}>
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Ban className="mr-1.5 h-4 w-4" />
          )}
          Add to blacklist
        </Button>
      </DialogFooter>
    </div>
  );
}
