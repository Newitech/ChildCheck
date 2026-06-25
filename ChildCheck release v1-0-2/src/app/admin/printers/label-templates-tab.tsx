"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, PencilLine, Plus, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  DEFAULT_LABEL_LAYOUT,
  type LabelField,
  type LabelFieldSource,
  type LabelFieldType,
  type LabelLayout,
} from "@/lib/printing";

// ---------------------------------------------------------------------------
// Types matching the API.
// ---------------------------------------------------------------------------

interface LabelTemplateItem {
  id: string;
  name: string;
  layout: LabelLayout;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const FIELD_LABELS: Record<LabelFieldSource, string> = {
  childName: "Child name",
  className: "Class",
  roomName: "Room",
  dailyCode: "Daily code",
  date: "Date",
  allergy: "Allergy icon",
};

const TYPE_LABELS: Record<LabelFieldType, string> = {
  text: "Text",
  code: "Code (mono)",
  date: "Date",
  allergy_icon: "Allergy icon (⚠)",
};

const ALL_SOURCES: LabelFieldSource[] = [
  "childName",
  "className",
  "roomName",
  "dailyCode",
  "date",
  "allergy",
];

// ---------------------------------------------------------------------------
// Live preview — renders the layout in a small scaled SVG so the admin can
// see where each field lands on the label.
// ---------------------------------------------------------------------------

function LabelPreview({ layout }: { layout: LabelLayout }) {
  // Fit the label into a 320px wide box.
  const previewWidth = 320;
  const previewHeight = Math.round((layout.height / layout.width) * previewWidth);
  const scale = previewWidth / layout.width;

  // Use sample data so the preview is meaningful.
  const sampleData: Record<LabelFieldSource, string> = {
    childName: "Mary Smith",
    className: "Kindergarten",
    roomName: "Room 1",
    dailyCode: "417",
    date: "Sat 24 May 2025",
    allergy: "Peanuts",
  };

  return (
    <div
      className="relative bg-white border border-border rounded shadow-sm mx-auto"
      style={{ width: previewWidth, height: previewHeight }}
      aria-label="Label preview"
    >
      {layout.fields.map((f) => {
        const val = sampleData[f.field] ?? "";
        const left = f.x * scale;
        const top = f.y * scale;
        const fontPx = Math.max(6, f.fontSize * scale * 0.7);
        if (f.type === "allergy_icon") {
          return (
            <div
              key={f.id}
              className="absolute font-bold"
              style={{
                left,
                top,
                fontSize: fontPx,
                color: "#b91c1c",
                lineHeight: 1.1,
              }}
            >
              ⚠
            </div>
          );
        }
        const text = f.prefix ? `${f.prefix}${val}` : val;
        const isCode = f.type === "code";
        return (
          <div
            key={f.id}
            className="absolute"
            style={{
              left,
              top,
              fontSize: fontPx,
              fontWeight: f.bold ? 700 : 400,
              fontFamily: isCode
                ? "'Courier New', monospace"
                : "Arial, Helvetica, sans-serif",
              color: "#000",
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              letterSpacing: isCode ? "1px" : "normal",
            }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LabelTemplatesTab() {
  const [items, setItems] = useState<LabelTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LabelTemplateItem | null>(null);
  const [deleting, setDeleting] = useState<LabelTemplateItem | null>(null);

  // Form state.
  const [fName, setFName] = useState("");
  const [fWidth, setFWidth] = useState(DEFAULT_LABEL_LAYOUT.width);
  const [fHeight, setFHeight] = useState(DEFAULT_LABEL_LAYOUT.height);
  const [fFields, setFFields] = useState<LabelField[]>(DEFAULT_LABEL_LAYOUT.fields);
  const [fIsDefault, setFIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/label-templates", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: LabelTemplateItem[] };
      setItems(data.items);
    } catch (e) {
      toast.error("Failed to load label templates", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setFName("New label");
    setFWidth(DEFAULT_LABEL_LAYOUT.width);
    setFHeight(DEFAULT_LABEL_LAYOUT.height);
    setFFields(DEFAULT_LABEL_LAYOUT.fields.map((f) => ({ ...f })));
    setFIsDefault(false);
    setFormOpen(true);
  };

  const openEdit = (t: LabelTemplateItem) => {
    setEditing(t);
    setFName(t.name);
    setFWidth(t.layout.width);
    setFHeight(t.layout.height);
    setFFields(t.layout.fields.map((f) => ({ ...f })));
    setFIsDefault(t.isDefault);
    setFormOpen(true);
  };

  const toggleField = (source: LabelFieldSource) => {
    setFFields((prev) => {
      const existing = prev.find((f) => f.field === source);
      if (existing) {
        return prev.filter((f) => f.field !== source);
      }
      const defaults = DEFAULT_LABEL_LAYOUT.fields.find((f) => f.field === source);
      const newField: LabelField = defaults ?? {
        id: source,
        type: source === "allergy" ? "allergy_icon" : source === "dailyCode" ? "code" : "text",
        field: source,
        x: 5,
        y: 5 + prev.length * 8,
        fontSize: 12,
      };
      return [...prev, newField];
    });
  };

  const updateField = (id: string, patch: Partial<LabelField>) => {
    setFFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const layout: LabelLayout = {
        width: Number(fWidth),
        height: Number(fHeight),
        fields: fFields,
      };
      const payload = {
        name: fName.trim(),
        layout,
        isDefault: fIsDefault,
      };
      const url = editing
        ? `/api/admin/label-templates/${editing.id}`
        : "/api/admin/label-templates";
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
      toast.success(editing ? "Template updated" : "Template created");
      setFormOpen(false);
      void load();
    } catch (e) {
      toast.error("Failed to save template", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/admin/label-templates/${deleting.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Template deleted");
      setDeleting(null);
      void load();
    } catch (e) {
      toast.error("Failed to delete template", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const previewLayout: LabelLayout = useMemo(
    () => ({
      width: Number(fWidth) || DEFAULT_LABEL_LAYOUT.width,
      height: Number(fHeight) || DEFAULT_LABEL_LAYOUT.height,
      fields: fFields,
    }),
    [fWidth, fHeight, fFields],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          The kiosk renders the default template for every printed name label.
          Use the editor to toggle fields and adjust sizing.
        </p>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> New template
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="inline h-5 w-5 animate-spin mr-2" /> Loading templates…
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No templates yet.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="max-h-[60vh] overflow-y-auto scroll-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[120px]">Dimensions</TableHead>
                  <TableHead className="w-[100px]">Fields</TableHead>
                  <TableHead className="w-[80px]">Default</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => (
                  <TableRow key={t.id} className="hover:bg-muted/40">
                    <TableCell>
                      <div className="font-medium">{t.name}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.layout.width}×{t.layout.height} mm
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.layout.fields.length}</Badge>
                    </TableCell>
                    <TableCell>
                      {t.isDefault && (
                        <Star className="h-4 w-4 text-amber-500" aria-label="Default" />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${t.name}`}
                          onClick={() => openEdit(t)}
                        >
                          <PencilLine className="h-4 w-4" />
                        </Button>
                        <AlertDialog
                          open={deleting?.id === t.id}
                          onOpenChange={(o) => setDeleting(o ? t : null)}
                        >
                          <button
                            type="button"
                            onClick={() => setDeleting(t)}
                            aria-label={`Delete ${t.name}`}
                            className="inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {t.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently deletes the template. If it was
                                the default, the most recent remaining template
                                is promoted to default.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => void handleDelete()}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Editor dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit label template" : "New label template"}
            </DialogTitle>
            <DialogDescription>
              Toggle which fields appear on the label, set the dimensions, and
              tweak each field&apos;s position + font size. The live preview
              shows the result with sample data.
            </DialogDescription>
          </DialogHeader>
          <div className="grid md:grid-cols-2 gap-6 py-2 max-h-[70vh] overflow-y-auto scroll-thin">
            {/* Left: form */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="t-name">Template name</Label>
                <Input
                  id="t-name"
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="t-width">Width (mm)</Label>
                  <Input
                    id="t-width"
                    type="number"
                    step="0.1"
                    min={10}
                    max={500}
                    value={fWidth}
                    onChange={(e) => setFWidth(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-height">Height (mm)</Label>
                  <Input
                    id="t-height"
                    type="number"
                    step="0.1"
                    min={10}
                    max={500}
                    value={fHeight}
                    onChange={(e) => setFHeight(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Fields included</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_SOURCES.map((src) => {
                    const checked = fFields.some((f) => f.field === src);
                    return (
                      <label
                        key={src}
                        className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/40"
                      >
                        <Switch
                          checked={checked}
                          onCheckedChange={() => toggleField(src)}
                          aria-label={`Include ${FIELD_LABELS[src]}`}
                        />
                        <span className="text-sm">{FIELD_LABELS[src]}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {fFields.length > 0 && (
                <div className="space-y-2">
                  <Label>Per-field settings</Label>
                  <div className="space-y-3 max-h-[40vh] overflow-y-auto scroll-thin pr-1">
                    {fFields.map((f) => (
                      <div
                        key={f.id}
                        className="rounded-md border p-3 space-y-2 bg-muted/20"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {FIELD_LABELS[f.field]}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {TYPE_LABELS[f.type]}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <div>
                            <Label htmlFor={`f-${f.id}-x`} className="text-[10px]">X (mm)</Label>
                            <Input
                              id={`f-${f.id}-x`}
                              type="number"
                              step="0.5"
                              value={f.x}
                              onChange={(e) => updateField(f.id, { x: Number(e.target.value) })}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`f-${f.id}-y`} className="text-[10px]">Y (mm)</Label>
                            <Input
                              id={`f-${f.id}-y`}
                              type="number"
                              step="0.5"
                              value={f.y}
                              onChange={(e) => updateField(f.id, { y: Number(e.target.value) })}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`f-${f.id}-sz`} className="text-[10px]">Size pt</Label>
                            <Input
                              id={`f-${f.id}-sz`}
                              type="number"
                              min={4}
                              max={120}
                              value={f.fontSize}
                              onChange={(e) => updateField(f.id, { fontSize: Number(e.target.value) })}
                            />
                          </div>
                          <div className="flex items-end pb-1">
                            <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                              <Switch
                                checked={Boolean(f.bold)}
                                onCheckedChange={(v) => updateField(f.id, { bold: v })}
                                aria-label={`Bold ${FIELD_LABELS[f.field]}`}
                              />
                              Bold
                            </label>
                          </div>
                        </div>
                        {f.field !== "allergy" && (
                          <div>
                            <Label htmlFor={`f-${f.id}-prefix`} className="text-[10px]">
                              Prefix (e.g. &quot;Class: &quot;)
                            </Label>
                            <Input
                              id={`f-${f.id}-prefix`}
                              value={f.prefix ?? ""}
                              onChange={(e) => updateField(f.id, { prefix: e.target.value })}
                              maxLength={40}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Switch
                  id="t-default"
                  checked={fIsDefault}
                  onCheckedChange={setFIsDefault}
                />
                <Label htmlFor="t-default" className="text-sm cursor-pointer">
                  Use as default for new label prints
                </Label>
              </div>
            </div>

            {/* Right: live preview */}
            <div className="space-y-3">
              <Label>Live preview</Label>
              <div className="rounded-md border bg-muted/30 p-4 flex items-center justify-center">
                <LabelPreview layout={previewLayout} />
              </div>
              <p className="text-xs text-muted-foreground">
                Preview uses sample data: <em>Mary Smith, Kindergarten, Room 1, code 417, Peanuts allergy, Sat 24 May 2025</em>.
                The actual print uses the checked-in child&apos;s data.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !fName.trim()}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
