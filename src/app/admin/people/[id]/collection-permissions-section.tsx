"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
} from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AuthorisedCollector {
  personId: string;
  firstName: string;
  lastName: string;
  basis: "primary_carer" | "authorised_guardian" | "older_sibling";
  familyName?: string;
  conditions?: string | null;
}

interface BlacklistEntry {
  id: string;
  reason: string;
  severity: string;
  collectorName: string | null;
  collectorDescription: string | null;
  personId: string | null;
  scope: "child" | "family";
  familyName?: string | null;
  childName?: string | null;
}

interface PermissionsData {
  personId: string;
  personName: string;
  olderSiblingFlagOn: boolean;
  authorisedCollectors: AuthorisedCollector[];
  blacklistEntries: BlacklistEntry[];
}

interface Props {
  personId: string;
}

const BASIS_LABEL: Record<AuthorisedCollector["basis"], string> = {
  primary_carer: "Primary carer",
  authorised_guardian: "Authorised guardian",
  older_sibling: "Older sibling",
};

/**
 * "Collection permissions" section — Child person detail.
 *
 * Complete "who can collect this child" view, split into:
 *   1. Authorised (primary carers + guardians + older siblings if flag on).
 *   2. Blocked / flagged (blacklist entries targeting this child or its family).
 *
 * Reflects the canCollectChild() decision order exactly: blacklist FIRST
 * (hard stop), then relationships.
 */
export function PersonCollectionPermissionsSection({ personId }: Props) {
  const { t } = useTerminology();
  const [data, setData] = useState<PermissionsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/people/${personId}/collection-permissions`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const d = (await res.json()) as PermissionsData;
      setData(d);
    } catch (e) {
      toast.error("Failed to load collection permissions", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Collection permissions
        </CardTitle>
        <CardDescription>
          Who is authorised to sign this {t("child").toLowerCase()} in and out,
          and who is blocked. Blacklist entries take precedence over
          relationships.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-xs text-muted-foreground flex items-center">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading…
          </p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">
            Failed to load permissions.
          </p>
        ) : (
          <>
            {/* Authorised collectors */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Authorised to collect ({data.authorisedCollectors.length})
              </p>
              {data.authorisedCollectors.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No one is currently authorised to collect this{" "}
                  {t("child").toLowerCase()}.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.authorisedCollectors.map((c) => (
                    <li
                      key={`${c.personId}:${c.basis}`}
                      className="flex items-start justify-between gap-2 rounded-md border p-2"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {c.basis === "primary_carer" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                        ) : c.basis === "authorised_guardian" ? (
                          <ShieldCheck className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        ) : (
                          <UserCheck className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <Link
                            href={`/admin/people/${c.personId}`}
                            className="font-medium hover:underline"
                          >
                            {c.firstName} {c.lastName}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {BASIS_LABEL[c.basis]}
                            {c.familyName ? ` · ${c.familyName}` : ""}
                          </p>
                          {c.conditions && (
                            <p className="text-xs text-amber-700 mt-0.5">
                              Conditions: {c.conditions}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        Allowed
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {!data.olderSiblingFlagOn && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Older-sibling authorisations are hidden (feature flag OFF).
                </p>
              )}
            </div>

            {/* Blacklist */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-destructive">
                Blocked / flagged ({data.blacklistEntries.length})
              </p>
              {data.blacklistEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No blacklist entries for this {t("child").toLowerCase()}.
                </p>
              ) : (
                <ul className="space-y-1.5 max-h-72 overflow-y-auto scroll-thin">
                  {data.blacklistEntries.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-md border border-destructive/30 p-2 space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {e.collectorName ?? "Unknown collector"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            <span className="text-foreground">Reason:</span>{" "}
                            {e.reason}
                          </p>
                          {e.collectorDescription && (
                            <p className="text-xs text-muted-foreground">
                              {e.collectorDescription}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Scope:{" "}
                            {e.scope === "child"
                              ? `this ${t("child").toLowerCase()}`
                              : `whole ${t("family").toLowerCase()}`}
                            {e.familyName ? ` (${e.familyName})` : ""}
                          </p>
                        </div>
                        {e.severity === "blocked" ? (
                          <Badge
                            variant="destructive"
                            className="text-[10px] flex-shrink-0"
                          >
                            <Ban className="h-3 w-3 mr-1" /> Blocked
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-amber-100 text-amber-900 border-amber-300 flex-shrink-0"
                          >
                            <TriangleAlert className="h-3 w-3 mr-1" /> Flag
                          </Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
