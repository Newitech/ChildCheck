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
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
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

interface EventItem {
  id: string;
  name: string;
  description: string | null;
  date: string;
  endDate: string | null;
  location: string | null;
  program: { id: string; name: string; slug: string } | null;
  isActive: boolean;
  roomCount: number;
  classCount: number;
}

interface ProgramOption {
  id: string;
  name: string;
  slug: string;
}

interface RoomOption {
  id: string;
  name: string;
  code: string | null;
  building: string | null;
}

interface ClassOption {
  id: string;
  name: string;
  program: { id: string; name: string; slug: string };
}

interface EventDetail extends EventItem {
  rooms: Array<{ id: string; name: string; code: string | null; building: string | null; capacity: number | null }>;
  classes: Array<{ id: string; name: string; slug: string; program: { id: string; name: string; slug: string } }>;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventsList() {
  const { t } = useTerminology();

  const [items, setItems] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [upcoming, setUpcoming] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EventItem | null>(null);

  // Form state
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [fName, setFName] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fDate, setFDate] = useState("");
  const [fEndDate, setFEndDate] = useState("");
  const [fLocation, setFLocation] = useState("");
  const [fProgramId, setFProgramId] = useState<string>("__none__");
  const [fRoomIds, setFRoomIds] = useState<string[]>([]);
  const [fClassIds, setFClassIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (upcoming) params.set("upcoming", "true");
      if (includeInactive) params.set("includeInactive", "true");
      const res = await fetch(`/api/admin/events?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: EventItem[] };
      setItems(data.items);
    } catch (e) {
      toast.error("Failed to load events", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [upcoming, includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadOptions = useCallback(async () => {
    try {
      const [progRes, roomsRes, classesRes] = await Promise.all([
        fetch("/api/admin/programs", { cache: "no-store" }),
        fetch("/api/admin/rooms", { cache: "no-store" }),
        // Classes: pull all programs' classes via the program-detail routes.
        // For simplicity, we fetch each program's classes — or we just fetch
        // all programs and grab their classes via the program detail endpoint.
        fetch("/api/admin/programs", { cache: "no-store" }),
      ]);
      if (progRes.ok) {
        const d = (await progRes.json()) as { items: ProgramOption[] };
        setPrograms(d.items);
      }
      if (roomsRes.ok) {
        const d = (await roomsRes.json()) as { items: RoomOption[] };
        setRooms(d.items);
      }
      // For classes, we need to fetch each program's classes. This is N+1
      // but the typical org has 4-6 programs. Cache-bust to be safe.
      if (progRes.ok) {
        const progList = (await progRes.json()) as { items: ProgramOption[] };
        const allClasses: ClassOption[] = [];
        await Promise.all(
          progList.items.map(async (p) => {
            try {
              const r = await fetch(`/api/admin/programs/${p.id}/classes`, {
                cache: "no-store",
              });
              if (r.ok) {
                const d = (await r.json()) as {
                  items: Array<{ id: string; name: string; slug: string }>;
                };
                for (const c of d.items) {
                  allClasses.push({
                    id: c.id,
                    name: c.name,
                    program: { id: p.id, name: p.name, slug: p.slug },
                  });
                }
              }
            } catch {
              /* skip */
            }
          }),
        );
        setClasses(allClasses);
      }
    } catch {
      /* degrade gracefully */
    }
  }, []);

  const openCreate = () => {
    void loadOptions();
    setEditingId(null);
    setFName("");
    setFDescription("");
    // Default to today 18:00.
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    setFDate(toLocalInputValue(now.toISOString()));
    setFEndDate("");
    setFLocation("");
    setFProgramId("__none__");
    setFRoomIds([]);
    setFClassIds([]);
    setFormOpen(true);
  };

  const openEdit = async (ev: EventItem) => {
    await loadOptions();
    try {
      const res = await fetch(`/api/admin/events/${ev.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const d = (await res.json()) as EventDetail;
      setEditingId(ev.id);
      setFName(d.name);
      setFDescription(d.description ?? "");
      setFDate(toLocalInputValue(d.date));
      setFEndDate(toLocalInputValue(d.endDate));
      setFLocation(d.location ?? "");
      setFProgramId(d.program?.id ?? "__none__");
      setFRoomIds(d.rooms.map((r) => r.id));
      setFClassIds(d.classes.map((c) => c.id));
      setFormOpen(true);
    } catch (e) {
      toast.error("Failed to load event detail", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (!fDate) {
        toast.error("Date is required");
        setSaving(false);
        return;
      }
      const payload: Record<string, unknown> = {
        name: fName.trim(),
        description: fDescription.trim() || null,
        date: new Date(fDate).toISOString(),
        endDate: fEndDate ? new Date(fEndDate).toISOString() : null,
        location: fLocation.trim() || null,
        programId: fProgramId === "__none__" ? null : fProgramId,
        roomIds: fRoomIds,
        classIds: fClassIds,
      };
      const url = editingId ? `/api/admin/events/${editingId}` : "/api/admin/events";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(editingId ? "Event updated" : "Event created");
      setFormOpen(false);
      void load();
    } catch (e) {
      toast.error("Failed to save event", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/admin/events/${deleting.id}`, {
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
      toast.error("Failed to delete event", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const toggleRoom = (id: string, on: boolean) => {
    setFRoomIds((prev) =>
      on ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
    );
  };
  const toggleClass = (id: string, on: boolean) => {
    setFClassIds((prev) =>
      on ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
    );
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 h-9">
            <Switch
              id="upcoming-only"
              checked={upcoming}
              onCheckedChange={setUpcoming}
              aria-label="Upcoming only"
            />
            <Label htmlFor="upcoming-only" className="text-xs cursor-pointer">
              Upcoming only
            </Label>
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 h-9">
            <Switch
              id="include-inactive-events"
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
              aria-label="Include archived"
            />
            <Label htmlFor="include-inactive-events" className="text-xs cursor-pointer">
              Archived
            </Label>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> Add event
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="inline h-5 w-5 animate-spin mr-2" /> Loading events…
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No events found. Click{" "}
            <span className="font-medium text-foreground">Add event</span> to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="max-h-[70vh] overflow-y-auto scroll-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[220px]">Date</TableHead>
                  <TableHead className="w-[160px]">Location</TableHead>
                  <TableHead className="w-[140px]">Program</TableHead>
                  <TableHead className="w-[120px]">{t("room_plural")}/{t("group_plural")}</TableHead>
                  <TableHead className="w-[80px]">Status</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((ev) => (
                  <TableRow key={ev.id} className="hover:bg-muted/40">
                    <TableCell>
                      <div className="font-medium">{ev.name}</div>
                      {ev.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {ev.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{formatDateTime(ev.date)}</div>
                      {ev.endDate && (
                        <div className="text-xs text-muted-foreground">
                          → {formatDateTime(ev.endDate)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ev.location ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {ev.program ? (
                        <Badge variant="outline">{ev.program.name}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Badge variant="outline" className="mr-1">
                        {ev.roomCount} {t("room").toLowerCase()}
                      </Badge>
                      <Badge variant="outline">
                        {ev.classCount} {t("group").toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {ev.isActive ? (
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
                          aria-label={`Edit ${ev.name}`}
                          onClick={() => void openEdit(ev)}
                        >
                          <PencilLine className="h-4 w-4" />
                        </Button>
                        <AlertDialog
                          open={deleting?.id === ev.id}
                          onOpenChange={(o) => setDeleting(o ? ev : null)}
                        >
                          <button
                            type="button"
                            onClick={() => setDeleting(ev)}
                            aria-label={`Archive ${ev.name}`}
                            className="inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Archive {ev.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This soft-deletes the event (sets <code>isActive=false</code>).
                                The kiosk will no longer show it.
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit event" : "Add event"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the event details, associated rooms and classes."
                : "Create a one-off or occasional event. Optionally associate it with a program, rooms and classes."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ev-name">Name</Label>
              <Input
                id="ev-name"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="e.g. Community Fun Day 2025"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ev-date">Start date &amp; time</Label>
                <Input
                  id="ev-date"
                  type="datetime-local"
                  value={fDate}
                  onChange={(e) => setFDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-end">End date &amp; time (optional)</Label>
                <Input
                  id="ev-end"
                  type="datetime-local"
                  value={fEndDate}
                  onChange={(e) => setFEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ev-location">Location</Label>
                <Input
                  id="ev-location"
                  value={fLocation}
                  onChange={(e) => setFLocation(e.target.value)}
                  placeholder="e.g. Main Hall"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-program">Program (optional)</Label>
                <Select value={fProgramId} onValueChange={setFProgramId}>
                  <SelectTrigger id="ev-program" aria-label="Associate program">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">— standalone —</span>
                    </SelectItem>
                    {programs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-desc">Description</Label>
              <Textarea
                id="ev-desc"
                value={fDescription}
                onChange={(e) => setFDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("room_plural")}</Label>
                <div className="rounded-md border max-h-40 overflow-y-auto scroll-thin p-2 space-y-2">
                  {rooms.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-2">No rooms available.</p>
                  ) : (
                    rooms.map((r) => (
                      <label
                        key={r.id}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5"
                      >
                        <Checkbox
                          checked={fRoomIds.includes(r.id)}
                          onCheckedChange={(v) => toggleRoom(r.id, v === true)}
                          aria-label={`Select room ${r.name}`}
                        />
                        <span className="truncate">
                          {r.name}
                          {r.code ? ` (${r.code})` : ""}
                          {r.building ? ` · ${r.building}` : ""}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("group_plural")}</Label>
                <ScrollArea className="rounded-md border max-h-40 p-2">
                  <div className="space-y-2">
                    {classes.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-2">No classes available.</p>
                    ) : (
                      classes.map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5"
                        >
                          <Checkbox
                            checked={fClassIds.includes(c.id)}
                            onCheckedChange={(v) => toggleClass(c.id, v === true)}
                            aria-label={`Select class ${c.name}`}
                          />
                          <span className="truncate">
                            {c.name}
                            <span className="text-xs text-muted-foreground">
                              {" "}· {c.program.name}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !fName.trim() || !fDate}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editingId ? "Save changes" : "Create event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
