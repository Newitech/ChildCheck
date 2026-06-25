"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ShieldCheck, UserPlus, X } from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

interface GuardianRow {
  membershipId: string;
  role: string;
  createdAt: string;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    personType: string;
    email: string | null;
    phone: string | null;
    hasPhoto: boolean;
    isVisitor: boolean;
    isActive: boolean;
  };
}

interface SearchResult {
  id: string;
  firstName: string;
  lastName: string;
  personType: string;
  email: string | null;
}

interface Props {
  familyId: string;
  familyName: string;
  /** When false, the Add/Remove controls are hidden (read-only). */
  canEdit: boolean;
}

/**
 * Dedicated "Authorised Guardians" section for the family detail page (Stage 4).
 *
 * Guardians have sign-in/out rights but NO edit rights on the family's data —
 * surfaced explicitly via the "no edit rights" badge so admins don't confuse
 * them with Primary Carers.
 *
 * Adds Adults only (enforced server-side; the search below also filters to
 * Adults for clarity).
 */
export function FamilyAuthorisedGuardiansSection({
  familyId,
  familyName,
  canEdit,
}: Props) {
  const { t } = useTerminology();
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [addQ, setAddQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/families/${familyId}/guardians`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { guardians: GuardianRow[] };
      setGuardians(data.guardians);
    } catch (e) {
      toast.error("Failed to load guardians", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!addQ.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const h = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/people?q=${encodeURIComponent(addQ)}&personType=Adult&pageSize=20`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { items: SearchResult[] };
        setResults(
          data.items.filter(
            (p) => !guardians.some((g) => g.person.id === p.id),
          ),
        );
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(h);
  }, [addQ, guardians]);

  const handleAdd = async (personId: string) => {
    setAdding(personId);
    try {
      const res = await fetch(`/api/admin/families/${familyId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, role: "AuthorisedGuardian" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Authorised guardian added");
      setAddQ("");
      setResults([]);
      await load();
    } catch (e) {
      toast.error("Failed to add guardian", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setAdding(null);
    }
  };

  const handleRemove = async (personId: string, name: string) => {
    try {
      const res = await fetch(
        `/api/admin/families/${familyId}/members/${personId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(`${name} removed as guardian`);
      await load();
    } catch (e) {
      toast.error("Failed to remove guardian", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> {t("guardian_plural")}
        </CardTitle>
        <CardDescription>
          Adults who may sign this {t("family").toLowerCase()}&rsquo;s{" "}
          {t("child_plural").toLowerCase()} in and out — but cannot edit the
          family record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-xs text-muted-foreground flex items-center">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading…
          </p>
        ) : guardians.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No {t("guardian_plural").toLowerCase()} linked to {familyName} yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {guardians.map((g) => (
              <li
                key={g.membershipId}
                className="flex items-start justify-between gap-3 rounded-md border p-2"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <img
                    src={`/api/people/${g.person.id}/photo`}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover bg-muted flex-shrink-0"
                    loading="lazy"
                  />
                  <div className="min-w-0">
                    <Link
                      href={`/admin/people/${g.person.id}`}
                      className="font-medium hover:underline"
                    >
                      {g.person.firstName} {g.person.lastName}
                    </Link>
                    {g.person.preferredName && (
                      <p className="text-xs text-muted-foreground">
                        &ldquo;{g.person.preferredName}&rdquo;
                      </p>
                    )}
                    {g.person.email && (
                      <p className="text-xs text-muted-foreground truncate">
                        {g.person.email}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                      <Badge
                        variant="secondary"
                        className="text-[10px] bg-amber-100 text-amber-900 hover:bg-amber-200"
                      >
                        Sign-in/out only — no edit rights
                      </Badge>
                      {g.person.isVisitor && (
                        <Badge variant="outline" className="text-[10px]">
                          Visitor
                        </Badge>
                      )}
                      {!g.person.isActive && (
                        <Badge variant="destructive" className="text-[10px]">
                          Archived
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                {canEdit && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove guardian"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Remove {g.person.firstName} {g.person.lastName} as a
                          guardian of {familyName}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          They will no longer be able to sign this{" "}
                          {t("family").toLowerCase()}&rsquo;s{" "}
                          {t("child_plural").toLowerCase()} in or out. The
                          person record itself is not affected.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            void handleRemove(
                              g.person.id,
                              `${g.person.firstName} ${g.person.lastName}`,
                            )
                          }
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
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <UserPlus className="h-4 w-4" /> Add {t("guardian").toLowerCase()}
            </p>
            <Input
              placeholder="Search adults by name, email, phone…"
              value={addQ}
              onChange={(e) => setAddQ(e.target.value)}
            />
            {searching && (
              <p className="text-xs text-muted-foreground flex items-center">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Searching…
              </p>
            )}
            {results.length > 0 && (
              <ul className="border rounded-md divide-y max-h-48 overflow-y-auto scroll-thin">
                {results.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 p-2 text-sm hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {p.firstName} {p.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Adult{p.email ? ` · ${p.email}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={adding === p.id}
                      onClick={() => void handleAdd(p.id)}
                    >
                      {adding === p.id ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : null}
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {addQ.trim() && !searching && results.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No matching adults found. Adults only can be guardians.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
