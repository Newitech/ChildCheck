"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  CalendarDays,
  DoorOpen,
  Loader2,
  PencilLine,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from "@/components/ui/alert-dialog";

interface ProgramItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  classCount: number;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function ProgramsList() {
  const router = useRouter();
  const { t } = useTerminology();

  const [items, setItems] = useState<ProgramItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProgramItem | null>(null);
  const [deleting, setDeleting] = useState<ProgramItem | null>(null);

  const [seedOpen, setSeedOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Create / edit form state
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formColor, setFormColor] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (includeInactive) params.set("includeInactive", "true");
      const res = await fetch(`/api/admin/programs?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: ProgramItem[] };
      setItems(data.items);
    } catch (e) {
      toast.error("Failed to load programs", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormSlug("");
    setFormDescription("");
    setFormColor("");
    setFormSortOrder(0);
    setCreateOpen(true);
  };

  const openEdit = (p: ProgramItem) => {
    setEditing(p);
    setFormName(p.name);
    setFormSlug(p.slug);
    setFormDescription(p.description ?? "");
    setFormColor(p.color ?? "");
    setFormSortOrder(p.sortOrder);
    setCreateOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: formName.trim(),
        description: formDescription.trim() || null,
        color: formColor.trim() || null,
        sortOrder: Number(formSortOrder) || 0,
      };
      if (!editing) {
        // Derive slug on create.
        const slug = formSlug.trim() ? slugify(formSlug) : slugify(formName);
        if (!slug) {
          toast.error("Could not derive a valid slug from the program name");
          setSaving(false);
          return;
        }
        payload.slug = slug;
      }

      const url = editing
        ? `/api/admin/programs/${editing.id}`
        : "/api/admin/programs";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(editing ? "Program updated" : "Program created");
      setCreateOpen(false);
      void load();
      router.refresh();
    } catch (e) {
      toast.error("Failed to save program", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (p: ProgramItem) => {
    try {
      const res = await fetch(`/api/admin/programs/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      toast.success(p.isActive ? "Program deactivated" : "Program activated");
      void load();
    } catch (e) {
      toast.error("Failed to toggle program", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/admin/programs/${deleting.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(`${deleting.name} archived.`);
      setDeleting(null);
      void load();
    } catch (e) {
      toast.error("Failed to delete program", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/admin/programs/seed", { method: "POST" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { created: number; skipped: number; orgType: string };
      toast.success(
        `Seeding complete — ${data.created} created, ${data.skipped} already present (${data.orgType}).`,
      );
      setSeedOpen(false);
      void load();
    } catch (e) {
      toast.error("Failed to seed default programs", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 h-9">
          <Switch
            id="include-inactive-programs"
            checked={includeInactive}
            onCheckedChange={setIncludeInactive}
            aria-label="Include archived programs"
          />
          <Label htmlFor="include-inactive-programs" className="text-xs cursor-pointer">
            Show archived
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setSeedOpen(true)}>
            <Sparkles className="mr-1.5 h-4 w-4" /> Seed default programs
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> Add program
          </Button>
        </div>
      </div>

      {/* Cards */}
      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="inline h-5 w-5 animate-spin mr-2" /> Loading programs…
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <CalendarDays className="mx-auto h-8 w-8 mb-2 opacity-60" />
            No programs yet. Click{" "}
            <span className="font-medium text-foreground">Seed default programs</span> to
            add the SDA defaults (Sabbath School, Pathfinders, Adventurers, Community
            Childcare), or <span className="font-medium text-foreground">Add program</span>{" "}
            to create a custom one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((p) => (
            <Card key={p.id} className="flex flex-col h-full">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      {p.color && (
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: p.color }}
                          aria-hidden
                        />
                      )}
                      <span className="truncate">{p.name}</span>
                    </CardTitle>
                    <CardDescription className="text-xs font-mono mt-0.5 truncate">
                      {p.slug}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {p.isDefault && (
                      <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-200">
                        Default
                      </Badge>
                    )}
                    {!p.isActive && <Badge variant="destructive">Archived</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                {p.description && (
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {p.description}
                  </p>
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline" className="gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {p.classCount} {p.classCount === 1 ? t("group") : t("group_plural")}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/admin/programs/${p.id}`}>Open</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(p)}
                    aria-label={`Edit ${p.name}`}
                  >
                    <PencilLine className="h-4 w-4" />
                  </Button>
                  <AlertDialog
                    open={deleting?.id === p.id}
                    onOpenChange={(o) => setDeleting(o ? p : null)}
                  >
                    <button
                      type="button"
                      onClick={() => setDeleting(p)}
                      aria-label={`Archive ${p.name}`}
                      className="inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Archive {p.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This soft-deletes the program (sets <code>isActive=false</code>).
                          Its classes remain in the database for audit/child-safety.
                          You can restore it from the &ldquo;Show archived&rdquo; toggle,
                          or re-run &ldquo;Seed default programs&rdquo; to recreate a
                          deleted default program.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleDelete()}>
                          Archive
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <div className="ml-auto flex items-center gap-2">
                    <Label
                      htmlFor={`active-${p.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Active
                    </Label>
                    <Switch
                      id={`active-${p.id}`}
                      checked={p.isActive}
                      onCheckedChange={() => void handleToggleActive(p)}
                      aria-label={`Toggle active for ${p.name}`}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap items-center gap-2 pt-4 border-t">
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/rooms">
            <DoorOpen className="mr-1.5 h-4 w-4" /> {t("room_plural")}
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/events">
            <CalendarDays className="mr-1.5 h-4 w-4" /> {t("event_plural")}
          </Link>
        </Button>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit program" : "Add program"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the program details. The slug cannot be changed after creation."
                : "Create a new program. The slug is derived from the name and must be unique."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="prog-name">Name</Label>
              <Input
                id="prog-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. VBS 2025"
              />
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="prog-slug">Slug (lowercase, unique)</Label>
                <Input
                  id="prog-slug"
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value)}
                  placeholder={slugify(formName) || "auto-derived from name"}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to auto-derive from the name.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="prog-desc">Description</Label>
              <Textarea
                id="prog-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="prog-color">Accent colour</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="prog-color"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    placeholder="#0f9d8a"
                    className="font-mono"
                  />
                  {formColor && (
                    <span
                      className="inline-block h-8 w-8 rounded border"
                      style={{ backgroundColor: formColor }}
                      aria-hidden
                    />
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prog-sort">Sort order</Label>
                <Input
                  id="prog-sort"
                  type="number"
                  value={formSortOrder}
                  onChange={(e) => setFormSortOrder(Number(e.target.value))}
                  min={0}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !formName.trim()}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create program"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Seed confirm */}
      <AlertDialog open={seedOpen} onOpenChange={setSeedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Seed default programs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create the default programs for your organisation type if
              they don&apos;t already exist. Existing programs are skipped — this
              is safe to run repeatedly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={seeding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSeed();
              }}
              disabled={seeding}
            >
              {seeding && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Seed now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
