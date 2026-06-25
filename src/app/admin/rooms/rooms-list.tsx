"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, PencilLine, Plus, Trash2 } from "lucide-react";

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

interface RoomItem {
  id: string;
  name: string;
  code: string | null;
  building: string | null;
  capacity: number | null;
  notes: string | null;
  isActive: boolean;
  classCount: number;
  createdAt: string;
  updatedAt: string;
}

export function RoomsList() {
  const { t } = useTerminology();

  const [items, setItems] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RoomItem | null>(null);
  const [deleting, setDeleting] = useState<RoomItem | null>(null);

  const [fName, setFName] = useState("");
  const [fCode, setFCode] = useState("");
  const [fBuilding, setFBuilding] = useState("");
  const [fCapacity, setFCapacity] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (includeInactive) params.set("includeInactive", "true");
      const res = await fetch(`/api/admin/rooms?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: RoomItem[] };
      setItems(data.items);
    } catch (e) {
      toast.error("Failed to load rooms", {
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
    setFCode("");
    setFBuilding("");
    setFCapacity("");
    setFNotes("");
    setFormOpen(true);
  };

  const openEdit = (r: RoomItem) => {
    setEditing(r);
    setFName(r.name);
    setFCode(r.code ?? "");
    setFBuilding(r.building ?? "");
    setFCapacity(r.capacity !== null ? String(r.capacity) : "");
    setFNotes(r.notes ?? "");
    setFormOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: fName.trim(),
        code: fCode.trim() || null,
        building: fBuilding.trim() || null,
        capacity: fCapacity.trim() === "" ? null : Number(fCapacity),
        notes: fNotes.trim() || null,
      };
      const url = editing ? `/api/admin/rooms/${editing.id}` : "/api/admin/rooms";
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
      toast.success(editing ? "Room updated" : "Room created");
      setFormOpen(false);
      void load();
    } catch (e) {
      toast.error("Failed to save room", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/admin/rooms/${deleting.id}`, {
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
      toast.error("Failed to delete room", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 h-9">
          <Switch
            id="include-inactive-rooms"
            checked={includeInactive}
            onCheckedChange={setIncludeInactive}
            aria-label="Include archived rooms"
          />
          <Label htmlFor="include-inactive-rooms" className="text-xs cursor-pointer">
            Show archived
          </Label>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> Add {t("room").toLowerCase()}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="inline h-5 w-5 animate-spin mr-2" /> Loading rooms…
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No rooms yet. Click{" "}
            <span className="font-medium text-foreground">Add {t("room").toLowerCase()}</span>{" "}
            to create your first room.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="max-h-[70vh] overflow-y-auto scroll-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[80px]">Code</TableHead>
                  <TableHead className="w-[160px]">Building</TableHead>
                  <TableHead className="w-[90px]">Capacity</TableHead>
                  <TableHead className="w-[90px]">{t("group_plural")}</TableHead>
                  <TableHead className="w-[80px]">Status</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/40">
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      {r.notes && (
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {r.notes}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {r.code ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.building ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.capacity ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.classCount}</Badge>
                    </TableCell>
                    <TableCell>
                      {r.isActive ? (
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
                          aria-label={`Edit ${r.name}`}
                          onClick={() => openEdit(r)}
                        >
                          <PencilLine className="h-4 w-4" />
                        </Button>
                        <AlertDialog
                          open={deleting?.id === r.id}
                          onOpenChange={(o) => setDeleting(o ? r : null)}
                        >
                          <button
                            type="button"
                            onClick={() => setDeleting(r)}
                            aria-label={`Archive ${r.name}`}
                            className="inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Archive {r.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This soft-deletes the room (sets <code>isActive=false</code>).
                                Classes currently assigned to this room will have their
                                assignment cleared automatically (they remain on the program).
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit room" : `Add ${t("room").toLowerCase()}`}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the room details."
                : "Define a physical room or area where check-in / out happens."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="r-name">Name</Label>
              <Input
                id="r-name"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="e.g. Room 1, Hall, Crib Room"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="r-code">Code</Label>
                <Input
                  id="r-code"
                  value={fCode}
                  onChange={(e) => setFCode(e.target.value)}
                  placeholder="e.g. R1"
                  maxLength={10}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-cap">Capacity</Label>
                <Input
                  id="r-cap"
                  type="number"
                  min={0}
                  value={fCapacity}
                  onChange={(e) => setFCapacity(e.target.value)}
                  placeholder="—"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-building">Building</Label>
              <Input
                id="r-building"
                value={fBuilding}
                onChange={(e) => setFBuilding(e.target.value)}
                placeholder="e.g. Main building"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-notes">Notes</Label>
              <Textarea
                id="r-notes"
                value={fNotes}
                onChange={(e) => setFNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !fName.trim()}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create room"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
