"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface GuardianFamily {
  membershipId: string;
  familyId: string;
  familyName: string;
  familyActive: boolean;
  createdAt: string;
}

interface Props {
  personId: string;
}

/**
 * "Guardian for families" section — shows every family where this Adult is an
 * AuthorisedGuardian. Stage 4: guardians have sign-in/out rights but no edit
 * rights on the family's data.
 */
export function PersonGuardianFamiliesSection({ personId }: Props) {
  const { t } = useTerminology();
  const [families, setFamilies] = useState<GuardianFamily[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/people/${personId}/guardian-families`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as {
        families: GuardianFamily[];
        note?: string;
      };
      setFamilies(data.families ?? []);
    } catch (e) {
      toast.error("Failed to load guardian families", {
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
          <ShieldCheck className="h-4 w-4" /> {t("guardian")} for{" "}
          {t("family_plural").toLowerCase()}
        </CardTitle>
        <CardDescription>
          {t("family_plural").toLowerCase()} where this person is an{" "}
          {t("guardian").toLowerCase()} — sign-in/out rights only, no edit
          rights.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-xs text-muted-foreground flex items-center">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading…
          </p>
        ) : families.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not an {t("guardian").toLowerCase()} of any{" "}
            {t("family").toLowerCase()}.
          </p>
        ) : (
          <ul className="space-y-2">
            {families.map((f) => (
              <li
                key={f.membershipId}
                className="flex items-center justify-between gap-3 rounded-md border p-2"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/families/${f.familyId}`}
                    className="font-medium hover:underline"
                  >
                    {f.familyName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(f.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] bg-amber-100 text-amber-900 hover:bg-amber-200"
                >
                  Sign-in/out only
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
