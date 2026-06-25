"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfig } from "@/hooks/use-config";

/**
 * Daily check-out code settings — charset + length.
 *
 * Default: alphanumeric length 3 (~29,791 possibilities, ~30x harder to
 * brute-force than numeric-only). Admins can switch to numeric or change the
 * length (2–10). Existing codes remain valid until they age out.
 */
export function CodeSettingsForm() {
  const { config, refresh } = useConfig();
  const currentLen = String(config?.dailyCodeLength ?? 3);
  const currentCharset = config?.dailyCodeCharset ?? "alphanumeric";
  const [length, setLength] = useState(currentLen);
  const [charset, setCharset] = useState(currentCharset);
  const [saving, setSaving] = useState(false);

  const dirty = length !== currentLen || charset !== currentCharset;

  async function onSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/organisation/code-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyCodeLength: parseInt(length, 10),
          dailyCodeCharset: charset,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Could not save code settings");
        return;
      }
      toast.success("Code settings saved");
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  // Show the brute-force maths for the current selection.
  const lenN = parseInt(length, 10) || 3;
  const space = charset === "numeric" ? Math.pow(10, lenN) : Math.pow(31, lenN);
  const spaceLabel =
    space >= 1_000_000
      ? `${(space / 1_000_000).toFixed(1)}M`
      : space >= 1000
        ? `${(space / 1000).toFixed(1)}k`
        : String(space);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg">Daily check-out code</CardTitle>
            <CardDescription>
              The code guardians use for fast sign-out. Alphanumeric is much
              harder to brute-force than numbers alone.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="code-charset">Character set</Label>
            <Select value={charset} onValueChange={setCharset}>
              <SelectTrigger id="code-charset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alphanumeric">
                  Alphanumeric (A–Z, 2–9)
                </SelectItem>
                <SelectItem value="numeric">Numeric (0–9)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="code-length">Length</Label>
            <Input
              id="code-length"
              type="number"
              min={2}
              max={10}
              value={length}
              onChange={(e) => setLength(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4 space-y-1.5">
          <p className="text-sm font-medium">Brute-force resistance</p>
          <p className="text-sm text-muted-foreground">
            A {lenN}-character {charset === "numeric" ? "numeric" : "alphanumeric"}{" "}
            code has <span className="font-semibold text-foreground">~{spaceLabel}</span>{" "}
            possible values. {charset === "numeric" ? "Numeric is the weakest option." : "Alphanumeric is ~30× harder to guess than numeric for length 3."}
          </p>
          <p className="text-xs text-muted-foreground">
            Existing codes already issued today remain valid until they age out —
            new codes use these settings.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!dirty || saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
