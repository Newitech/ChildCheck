"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, PencilLine, Plus, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
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

interface AssignedRoom {
  id: string;
  roomId: string;
  roomName: string;
  roomCode: string | null;
}

interface PrinterItem {
  id: string;
  name: string;
  driver: string;
  queueName: string | null;
  isDefault: boolean;
  isActive: boolean;
  purpose: string;
  notes: string | null;
  rooms: AssignedRoom[];
  createdAt: string;
  updatedAt: string;
}

const DRIVER_LABELS: Record<string, string> = {
  browser: "Browser",
  qz_tray: "QZ Tray",
  thermal_raw: "Thermal raw",
};

const PURPOSE_LABELS: Record<string, string> = {
  label: "Labels",
  slip: "Slips",
  both: "Labels + Slips",
};

export function PrintersTab() {
  const [items, setItems] = useState<PrinterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PrinterItem | null>(null);
  const [deleting, setDeleting] = useState<PrinterItem | null>(null);

  const [fName, setFName] = useState("");
  const [fDriver, setFDriver] = useState<"browser" | "qz_tray" | "thermal_raw">("browser");
  const [fQueueName, setFQueueName] = useState("");
  const [fPurpose, setFPurpose] = useState<"label" | "slip" | "both">("both");
  const [fIsDefault, setFIsDefault] = useState(false);
  const [fIsActive, setFIsActive] = useState(true);
  const [fNotes, setFNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (includeInactive) params.set("includeInactive", "true");
      const res = await fetch(`/api/admin/printers?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: PrinterItem[] };
      setItems(data.items);
    } catch (e) {
      toast.error("Failed to load printers", {
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
    setFName("");
    setFDriver("browser");
    setFQueueName("");
    setFPurpose("both");
    setFIsDefault(false);
    setFIsActive(true);
    setFNotes("");
    setFormOpen(true);
  };

  const openEdit = (p: PrinterItem) => {
    setEditing(p);
    setFName(p.name);
    setFDriver(p.driver as "browser" | "qz_tray" | "thermal_raw");
    setFQueueName(p.queueName ?? "");
    setFPurpose(p.purpose as "label" | "slip" | "both");
    setFIsDefault(p.isDefault);
    setFIsActive(p.isActive);
    setFNotes(p.notes ?? "");
    setFormOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: fName.trim(),
        driver: fDriver,
        queueName: fQueueName.trim() || null,
        purpose: fPurpose,
        isDefault: fIsDefault,
        isActive: fIsActive,
        notes: fNotes.trim() || null,
      };
      const url = editing ? `/api/admin/printers/${editing.id}` : "/api/admin/printers";
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
      toast.success(editing ? "Printer updated" : "Printer created");
      setFormOpen(false);
      void load();
    } catch (e) {
      toast.error("Failed to save printer", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/admin/printers/${deleting.id}`, {
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
      toast.error("Failed to delete printer", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 h-9">
          <Switch
            id="include-inactive-printers"
            checked={includeInactive}
            onCheckedChange={setIncludeInactive}
            aria-label="Include archived printers"
          />
          <Label htmlFor="include-inactive-printers" className="text-xs cursor-pointer">
            Show archived
          </Label>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> Add printer
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="inline h-5 w-5 animate-spin mr-2" /> Loading printers…
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No printers yet. Click{" "}
            <span className="font-medium text-foreground">Add printer</span>{" "}
            to create one. Until then, the kiosk falls back to{" "}
            <span className="font-medium">browser printing</span>.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="max-h-[70vh] overflow-y-auto scroll-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[120px]">Driver</TableHead>
                  <TableHead className="w-[150px]">Queue</TableHead>
                  <TableHead className="w-[140px]">Purpose</TableHead>
                  <TableHead className="w-[160px]">Rooms</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/40">
                    <TableCell>
                      <div className="font-medium flex items-center gap-1.5">
                        {p.isDefault && (
                          <Star className="h-3.5 w-3.5 text-amber-500" aria-label="Default" />
                        )}
                        {p.name}
                      </div>
                      {p.notes && (
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {p.notes}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{DRIVER_LABELS[p.driver] ?? p.driver}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.queueName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {PURPOSE_LABELS[p.purpose] ?? p.purpose}
                    </TableCell>
                    <TableCell>
                      {p.rooms.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {p.rooms.slice(0, 3).map((r) => (
                            <Badge key={r.id} variant="secondary" className="text-[10px]">
                              {r.roomName}
                            </Badge>
                          ))}
                          {p.rooms.length > 3 && (
                            <Badge variant="secondary" className="text-[10px]">
                              +{p.rooms.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.isActive ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="destructive">Archived</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${p.name}`}
                          onClick={() => openEdit(p)}
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
                                This soft-deletes the printer (sets{" "}
                                <code>isActive=false</code>). Room assignments are
                                retained so the audit trail stays intact, but the
                                printer is no longer used for new prints.
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit printer" : "Add printer"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the printer configuration."
                : "Configure a label / slip printer. Browser printing works everywhere; QZ Tray requires the Java tray app on each kiosk."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="e.g. Room 1 Label Printer"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-driver">Driver</Label>
                <Select value={fDriver} onValueChange={(v) => setFDriver(v as typeof fDriver)}>
                  <SelectTrigger id="p-driver">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="browser">Browser (HTML)</SelectItem>
                    <SelectItem value="qz_tray">QZ Tray</SelectItem>
                    <SelectItem value="thermal_raw">Thermal raw (ESC/POS)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-purpose">Purpose</Label>
                <Select value={fPurpose} onValueChange={(v) => setFPurpose(v as typeof fPurpose)}>
                  <SelectTrigger id="p-purpose">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Labels + Slips</SelectItem>
                    <SelectItem value="label">Labels only</SelectItem>
                    <SelectItem value="slip">Slips only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-queue">
                Queue / CUPS name{" "}
                <span className="text-xs text-muted-foreground">
                  (only for QZ Tray / thermal raw)
                </span>
              </Label>
              <Input
                id="p-queue"
                value={fQueueName}
                onChange={(e) => setFQueueName(e.target.value)}
                placeholder="e.g. Brother_QL_820NWB"
                disabled={fDriver === "browser"}
                className="font-mono"
              />
              {fDriver === "browser" && (
                <p className="text-xs text-muted-foreground">
                  Browser driver uses the OS print dialog — no queue needed.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-notes">Notes</Label>
              <Textarea
                id="p-notes"
                value={fNotes}
                onChange={(e) => setFNotes(e.target.value)}
                rows={2}
                placeholder="Optional: location, paper size, IP, etc."
              />
            </div>
            <div className="flex flex-wrap gap-4 pt-1">
              <div className="flex items-center gap-2">
                <Switch
                  id="p-default"
                  checked={fIsDefault}
                  onCheckedChange={setFIsDefault}
                />
                <Label htmlFor="p-default" className="text-sm cursor-pointer">
                  Default printer (used when no room assignment matches)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="p-active"
                  checked={fIsActive}
                  onCheckedChange={setFIsActive}
                />
                <Label htmlFor="p-active" className="text-sm cursor-pointer">
                  Active
                </Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !fName.trim()}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create printer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
