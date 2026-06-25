"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2 } from "lucide-react";

import { useConfig } from "@/hooks/use-config";
import { getProfile, ORG_TYPES, type OrgProfile } from "@/lib/org-profiles";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";

/**
 * Org-type selector — Stage 3 dual org-type defaults.
 *
 * Lets the admin swap between SDA / SundayChurch / Scouts / Childcare /
 * School / Club / Other profiles. Each profile applies a MERGE of
 * terminology overrides + selected flag values over the current config.
 *
 * Confirmation dialog warns that customisations may be overwritten.
 */
export function OrgTypeSelector() {
  const { refresh } = useConfig();
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<string>("SDA");
  const [selected, setSelected] = useState<string>("SDA");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/branding", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { orgType?: string };
        if (cancelled) return;
        const t = data.orgType ?? "SDA";
        setCurrent(t);
        setSelected(t);
      } catch {
        // ignore — form will just default to SDA
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleApply = async () => {
    setApplying(true);
    try {
      const res = await fetch("/api/admin/organisation/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgType: selected }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      await refresh();
      setCurrent(selected);
      toast.success(
        `Profile applied — ${getProfile(selected).label} defaults are now in effect.`,
      );
    } catch (e) {
      toast.error("Failed to apply profile", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setApplying(false);
    }
  };

  const profile: OrgProfile = getProfile(selected);
  const isDirty = selected !== current;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" /> Organisation type
        </CardTitle>
        <CardDescription>
          Pick a profile to apply sensible terminology + toggle defaults for
          your kind of organisation. Application is a <strong>merge</strong> —
          it overwrites terminology/flags named by the profile but keeps other
          customisations you have made.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="org-type-select"
                  className="text-sm font-medium leading-none"
                >
                  Profile
                </label>
                <Select
                  value={selected}
                  onValueChange={(v) => setSelected(v)}
                >
                  <SelectTrigger id="org-type-select" className="w-full">
                    <SelectValue placeholder="Select a profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {getProfile(t).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium leading-none">Currently applied</p>
                <div className="flex items-center gap-2 h-9">
                  <Badge variant="secondary">{getProfile(current).label}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {current}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium leading-snug">{profile.label}</p>
              <p className="text-muted-foreground mt-1 leading-snug">
                {profile.description}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(profile.terminology).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-[10px] font-mono">
                    {k} → {v}
                  </Badge>
                ))}
                {Object.entries(profile.flags).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-[10px] font-mono">
                    {k}: {v ? "on" : "off"}
                  </Badge>
                ))}
                {Object.keys(profile.terminology).length === 0 &&
                  Object.keys(profile.flags).length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      No preset overrides — configure manually below.
                    </span>
                  )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!isDirty || applying}
                onClick={() => setSelected(current)}
              >
                Cancel
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!isDirty || applying}
                  >
                    {applying ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Building2 className="mr-1.5 h-4 w-4" />
                    )}
                    Apply {profile.label} profile
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Apply the {profile.label} profile?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This will reset terminology and selected toggles to the{" "}
                      {profile.label} defaults. Terminology keys and flags
                      named by the profile will be overwritten; other
                      customisations are preserved. Continue?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={applying}
                      onClick={() => void handleApply()}
                    >
                      Apply profile
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
