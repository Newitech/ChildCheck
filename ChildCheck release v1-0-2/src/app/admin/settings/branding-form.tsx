"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save, Trash2, Upload, RotateCcw } from "lucide-react";

import {
  DEFAULT_BRANDING,
  DEFAULT_TERMINOLOGY,
  type Terminology,
} from "@/lib/branding";
import { useConfig } from "@/hooks/use-config";
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

interface BrandingResponse {
  branding: typeof DEFAULT_BRANDING;
  terminology: Terminology;
  name: string;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const TERMINOLOGY_LABELS: { key: keyof Terminology; label: string }[] = [
  { key: "program_sabbath_school", label: "Sabbath School program term" },
  { key: "program_pathfinders", label: "Pathfinders program term" },
  { key: "program_adventurers", label: "Adventurers program term" },
  { key: "program_community_childcare", label: "Community Childcare program term" },
  { key: "group", label: "Group / Class term (singular)" },
  { key: "group_plural", label: "Group / Class term (plural)" },
  { key: "room", label: "Room term (singular)" },
  { key: "room_plural", label: "Room term (plural)" },
  { key: "carer", label: "Primary carer term (singular)" },
  { key: "carer_plural", label: "Primary carer term (plural)" },
  { key: "guardian", label: "Authorised guardian term (singular)" },
  { key: "guardian_plural", label: "Authorised guardian term (plural)" },
  { key: "child", label: "Child term (singular)" },
  { key: "child_plural", label: "Child term (plural)" },
  { key: "family", label: "Family term (singular)" },
  { key: "family_plural", label: "Family term (plural)" },
  { key: "volunteer", label: "Volunteer term (singular)" },
  { key: "volunteer_plural", label: "Volunteer term (plural)" },
  { key: "event", label: "Event term (singular)" },
  { key: "event_plural", label: "Event term (plural)" },
  { key: "organisation", label: "Organisation term (singular)" },
];

export function BrandingForm() {
  const router = useRouter();
  const { refresh } = useConfig();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [appName, setAppName] = useState("");
  const [tagline, setTagline] = useState("");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_BRANDING.primaryColor);
  const [accentColor, setAccentColor] = useState(DEFAULT_BRANDING.accentColor);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoCacheBust, setLogoCacheBust] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [term, setTerm] = useState<Record<string, string>>({ ...DEFAULT_TERMINOLOGY });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/branding", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: BrandingResponse = await res.json();
        if (cancelled) return;
        setName(data.name ?? "");
        setAppName(data.branding.appName);
        setTagline(data.branding.tagline);
        setPrimaryColor(data.branding.primaryColor);
        setAccentColor(data.branding.accentColor);
        setLogoUrl(data.branding.logoUrl);
        setTerm({ ...DEFAULT_TERMINOLOGY, ...data.terminology });
      } catch (e) {
        toast.error("Failed to load branding", {
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

  const handleSave = async () => {
    if (!HEX_RE.test(primaryColor) || !HEX_RE.test(accentColor)) {
      toast.error("Colours must be valid 6-digit hex (e.g. #0f9d8a).");
      return;
    }
    if (!appName.trim()) {
      toast.error("App name is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          appName: appName.trim(),
          tagline: tagline.trim(),
          primaryColor,
          accentColor,
          terminology: term,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      await refresh();
      router.refresh();
      toast.success("Branding saved");
    } catch (e) {
      toast.error("Failed to save branding", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetTerminology = async () => {
    setTerm({ ...DEFAULT_TERMINOLOGY });
    toast.info("Terminology reset to defaults — click Save to apply.");
  };

  const handleLogoUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/branding/logo", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as { logoUrl: string };
      setLogoUrl(data.logoUrl);
      setLogoCacheBust((n) => n + 1);
      await refresh();
      toast.success("Logo uploaded");
    } catch (e) {
      toast.error("Logo upload failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleLogoRemove = async () => {
    setUploading(true);
    try {
      const res = await fetch("/api/admin/branding/logo", { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      setLogoUrl(null);
      await refresh();
      toast.success("Logo removed");
    } catch (e) {
      toast.error("Failed to remove logo", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading branding…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Branding basics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Branding</CardTitle>
          <CardDescription>
            Organisation name, app title, tagline, colours and logo. Changes apply live across the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Organisation name" hint="Shown in footer + manifest">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </Field>
            <Field label="App name" hint="Browser title + headers">
              <Input value={appName} onChange={(e) => setAppName(e.target.value)} maxLength={60} />
            </Field>
          </div>
          <Field label="Tagline" hint="Up to 120 chars">
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Primary colour" hint="Buttons, links, accents">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Primary colour picker"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-12 rounded-md border border-input bg-background cursor-pointer"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  maxLength={7}
                  className="font-mono w-32"
                  aria-label="Primary colour hex"
                />
                <span
                  className="h-8 w-8 rounded-full border"
                  style={{ backgroundColor: primaryColor }}
                  aria-hidden
                />
              </div>
            </Field>
            <Field label="Accent colour" hint="Highlights, secondary accents">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Accent colour picker"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-10 w-12 rounded-md border border-input bg-background cursor-pointer"
                />
                <Input
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  maxLength={7}
                  className="font-mono w-32"
                  aria-label="Accent colour hex"
                />
                <span
                  className="h-8 w-8 rounded-full border"
                  style={{ backgroundColor: accentColor }}
                  aria-hidden
                />
              </div>
            </Field>
          </div>

          <Field label="Logo" hint="PNG / JPG / SVG / WebP · up to 2MB">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-md border bg-muted/30 flex items-center justify-center overflow-hidden">
                {logoUrl ? (
                  <img
                    key={logoCacheBust}
                    src={`/api/branding/logo?cb=${logoCacheBust}`}
                    alt="Current logo"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">No logo</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleLogoUpload(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4" />
                )}
                Upload
              </Button>
              {logoUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => void handleLogoRemove()}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> Remove
                </Button>
              )}
            </div>
          </Field>
        </CardContent>
      </Card>

      {/* Terminology */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Terminology</CardTitle>
            <CardDescription>
              Rename any term to fit your organisation (e.g. &ldquo;Sabbath School&rdquo; → &ldquo;Unit&rdquo;).
            </CardDescription>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <RotateCcw className="mr-1.5 h-4 w-4" /> Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset terminology to defaults?</AlertDialogTitle>
                <AlertDialogDescription>
                  This restores every term to its built-in default. You&apos;ll still need to click Save to apply.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleResetTerminology()}>
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TERMINOLOGY_LABELS.map(({ key, label }) => (
              <Field key={key} label={label} hint={`Default: ${DEFAULT_TERMINOLOGY[key]}`}>
                <Input
                  value={term[key] ?? ""}
                  onChange={(e) =>
                    setTerm((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  maxLength={40}
                />
              </Field>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2 sticky bottom-0 bg-background/85 backdrop-blur py-3 -mx-4 px-4 border-t sm:rounded">
        <Button onClick={() => void handleSave()} disabled={saving} size="default">
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
