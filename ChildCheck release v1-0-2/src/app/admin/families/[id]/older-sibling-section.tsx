"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, UserCheck, X } from "lucide-react";

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

interface OlderSiblingRow {
  id: string;
  youngerChildId: string;
  olderSiblingId: string;
  familyId: string;
  conditions: string | null;
  isActive: boolean;
  createdAt: string;
  youngerChild: { id: string; name: string; isActive: boolean };
  olderSibling: { id: string; name: string; isActive: boolean };
  family: { id: string; familyName: string };
}

interface ChildOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface Props {
  familyId: string;
  familyName: string;
  /** Children of this family — both younger and older siblings come from here. */
  childMembers: ChildOption[];
  canEdit: boolean;
}

/**
 * "Older-sibling authorisations" section for the family detail page (Stage 4).
 *
 * Gated entirely by the `older_sibling_collect` feature flag — when OFF, this
 * section returns null and the parent should not render it. (Caller
 * responsibility: only render this component when useFlags().isEnabled("older_sibling_collect").)
 *
 * An older sibling (any Person in the family — typically an older Child) is
 * authorised to collect a younger Child in the same family. Conditions can be
 * attached (e.g. "Only after 12pm", "Only if aged 16+").
 */
export function FamilyOlderSiblingSection({
  familyId,
  familyName,
  childMembers,
  canEdit,
}: Props) {
  const { t } = useTerminology();
  const [items, setItems] = useState<OlderSiblingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/older-sibling?familyId=${encodeURIComponent(familyId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: OlderSiblingRow[] };
      setItems(data.items);
    } catch (e) {
      toast.error("Failed to load older-sibling authorisations", {
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
      const res = await fetch(`/api/admin/older-sibling/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Authorisation removed");
      await load();
    } catch (e) {
      toast.error("Failed to remove authorisation", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserCheck className="h-4 w-4" /> Older-sibling authorisations
        </CardTitle>
        <CardDescription>
          Authorise an older sibling in {familyName} to collect a younger{" "}
          {t("child").toLowerCase()} in the same {t("family").toLowerCase()}.
          Conditions (e.g. &ldquo;only after 12pm&rdquo;) can be attached.
          Hidden when the older-sibling flag is OFF.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground flex items-center">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No older-sibling authorisations for this{" "}
            {t("family").toLowerCase()} yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((a) => (
              <li
                key={a.id}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm">
                    <Link
                      href={`/admin/people/${a.olderSibling.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.olderSibling.name}
                    </Link>{" "}
                    may collect{" "}
                    <Link
                      href={`/admin/people/${a.youngerChild.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.youngerChild.name}
                    </Link>
                  </p>
                  {a.conditions && (
                    <p className="text-xs text-muted-foreground">
                      Conditions: {a.conditions}
                    </p>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    {a.isActive ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-emerald-50 text-emerald-900 border-emerald-200"
                      >
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Authorised {new Date(a.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {canEdit && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove authorisation"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Remove this authorisation?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {a.olderSibling.name} will no longer be authorised
                          to collect {a.youngerChild.name}.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => void handleRemove(a.id)}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="mr-1.5 h-4 w-4" /> Authorise older sibling
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Authorise older sibling</DialogTitle>
                <DialogDescription>
                  Pick a younger {t("child").toLowerCase()} and an older
                  sibling from {familyName}. Both must be members of this{" "}
                  {t("family").toLowerCase()}.
                </DialogDescription>
              </DialogHeader>
              <AddOlderSiblingForm
                familyId={familyId}
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
  childMembers: ChildOption[];
  onDone: () => void;
}

function AddOlderSiblingForm({ familyId, childMembers, onDone }: AddFormProps) {
  const [youngerChildId, setYoungerChildId] = useState<string>("");
  const [olderSiblingId, setOlderSiblingId] = useState<string>("");
  const [conditions, setConditions] = useState("");
  const [saving, setSaving] = useState(false);

  // Family members (any Person — Adults too can be "older siblings" in the
  // data model, but the UI lists everyone). We pass children in via props but
  // also load ALL family members so older siblings can include adults.
  const [allMembers, setAllMembers] = useState<
    { id: string; firstName: string; lastName: string; personType: string; role: string }[]
  >([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/admin/families/${familyId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          members: {
            person: {
              id: string;
              firstName: string;
              lastName: string;
              personType: string;
            };
            role: string;
          }[];
        };
        setAllMembers(
          data.members
            .filter((m) => m.role !== "EmergencyContact")
            .map((m) => ({
              id: m.person.id,
              firstName: m.person.firstName,
              lastName: m.person.lastName,
              personType: m.person.personType,
              role: m.role,
            })),
        );
      } catch {
        // ignore — children prop is a fallback
      }
    })();
  }, [familyId]);

  // Default younger to first child if any.
  useEffect(() => {
    if (!youngerChildId && childMembers.length > 0) {
      setYoungerChildId(childMembers[0].id);
    }
  }, [youngerChildId, childMembers]);

  const canSubmit = useMemo(() => {
    if (!youngerChildId || !olderSiblingId) return false;
    if (youngerChildId === olderSiblingId) return false;
    return true;
  }, [youngerChildId, olderSiblingId]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/older-sibling`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youngerChildId,
          olderSiblingId,
          familyId,
          conditions: conditions.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Older-sibling authorisation added");
      onDone();
    } catch (e) {
      toast.error("Failed to add authorisation", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Younger child (who may be collected)</Label>
        <Select value={youngerChildId} onValueChange={setYoungerChildId}>
          <SelectTrigger aria-label="Younger child">
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
      </div>
      <div className="space-y-2">
        <Label>Older sibling (who is authorised to collect)</Label>
        <Select value={olderSiblingId} onValueChange={setOlderSiblingId}>
          <SelectTrigger aria-label="Older sibling">
            <SelectValue placeholder="Pick a sibling…" />
          </SelectTrigger>
          <SelectContent>
            {allMembers
              .filter((m) => m.id !== youngerChildId)
              .map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.firstName} {m.lastName} ({m.personType}, {m.role})
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="os-conditions">Conditions (optional)</Label>
        <Textarea
          id="os-conditions"
          placeholder="e.g. Only after 12pm, only if aged 16+"
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
          rows={2}
          maxLength={2000}
        />
      </div>
      <DialogFooter>
        <Button onClick={() => void handleSubmit()} disabled={!canSubmit || saving}>
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <UserCheck className="mr-1.5 h-4 w-4" />
          )}
          Authorise
        </Button>
      </DialogFooter>
    </div>
  );
}
