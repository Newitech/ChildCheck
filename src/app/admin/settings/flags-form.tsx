"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import {
  FEATURE_FLAGS,
  DEFAULT_FLAGS,
  type FlagCategory,
  type FlagDef,
} from "@/lib/feature-flags";
import { useConfig } from "@/hooks/use-config";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CATEGORY_ORDER: FlagCategory[] = [
  "Kiosk",
  "Guardians",
  "Security",
  "Photos & Printing",
  "Checkout",
  "Data & Privacy",
  "System",
];

const slug = (c: string) => c.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function FlagsForm() {
  const { refresh } = useConfig();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, boolean>>({ ...DEFAULT_FLAGS });
  const [initial, setInitial] = useState<Record<string, boolean>>({ ...DEFAULT_FLAGS });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/flags", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { flags: Record<string, boolean>; defs: FlagDef[] };
        if (cancelled) return;
        const merged = { ...DEFAULT_FLAGS, ...data.flags };
        setValues(merged);
        setInitial(merged);
      } catch (e) {
        toast.error("Failed to load flags", {
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<FlagCategory, FlagDef[]>();
    for (const def of FEATURE_FLAGS) {
      const list = map.get(def.category) ?? [];
      list.push(def);
      map.set(def.category, list);
    }
    return map;
  }, []);

  const dirty = useMemo(() => {
    for (const k of Object.keys(values)) {
      if (values[k] !== initial[k]) return true;
    }
    return false;
  }, [values, initial]);

  const handleSave = async () => {
    const diff: Record<string, boolean> = {};
    for (const k of Object.keys(values)) {
      if (values[k] !== initial[k]) diff[k] = values[k];
    }
    if (Object.keys(diff).length === 0) {
      toast.info("No changes to save.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flags: diff }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as { flags: Record<string, boolean> };
      const merged = { ...DEFAULT_FLAGS, ...data.flags };
      setValues(merged);
      setInitial(merged);
      await refresh();
      toast.success("Toggles saved");
    } catch (e) {
      toast.error("Failed to save toggles", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading feature flags…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Feature toggles</CardTitle>
          <CardDescription>
            Flip any feature on or off for this organisation. Changes apply
            immediately to all kiosks and dashboards (within ~5s).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2 mb-4">
            {CATEGORY_ORDER.map((cat) => {
              const count = grouped.get(cat)?.length ?? 0;
              if (count === 0) return null;
              return (
                <a
                  key={cat}
                  href={`#cat-${slug(cat)}`}
                  className="text-xs px-2 py-1 rounded-md border bg-muted/30 hover:bg-muted/60 transition-colors"
                >
                  {cat} <span className="text-muted-foreground">({count})</span>
                </a>
              );
            })}
          </div>

          <div className="max-h-[70vh] overflow-y-auto pr-1 -mr-1 scroll-thin space-y-5">
            {CATEGORY_ORDER.map((cat) => {
              const defs = grouped.get(cat);
              if (!defs || defs.length === 0) return null;
              return (
                <section key={cat} id={`cat-${slug(cat)}`} className="scroll-mt-4">
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background/90 backdrop-blur py-1.5">
                    <h3 className="text-sm font-semibold">{cat}</h3>
                    <Badge variant="outline" className="text-[10px]">
                      {defs.length}
                    </Badge>
                  </div>
                  <div className="space-y-3">
                    {defs.map((def) => (
                      <FlagRow
                        key={def.key}
                        def={def}
                        value={values[def.key] ?? def.default}
                        onChange={(v) =>
                          setValues((prev) => ({ ...prev, [def.key]: v }))
                        }
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2 sticky bottom-0 bg-background/85 backdrop-blur py-3 -mx-4 px-4 border-t sm:rounded">
        {dirty && (
          <span className="text-xs text-muted-foreground mr-auto">
            Unsaved changes
          </span>
        )}
        <Button onClick={() => void handleSave()} disabled={saving || !dirty}>
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          Save changes
        </Button>
      </div>
    </div>
  );
}

function FlagRow({
  def,
  value,
  onChange,
}: {
  def: FlagDef;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = `flag-${def.key}`;
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b last:border-b-0">
      <div className="space-y-0.5 min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {def.label}
        </Label>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {def.description}
        </p>
        <p className="text-[10px] text-muted-foreground/80">
          Default: {def.default ? "on" : "off"}
        </p>
      </div>
      <div className="pt-0.5">
        <Switch
          id={id}
          checked={value}
          onCheckedChange={onChange}
          aria-label={def.label}
        />
      </div>
    </div>
  );
}
