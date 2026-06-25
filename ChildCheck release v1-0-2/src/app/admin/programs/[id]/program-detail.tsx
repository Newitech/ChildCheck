"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Clock,
  Loader2,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

interface ProgramDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  classes: Array<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    ageMin: number | null;
    ageMax: number | null;
    gradeLevel: string | null;
    sortOrder: number;
    isDefault: boolean;
    room: { id: string; name: string; code: string | null; building: string | null } | null;
    scheduleSummary: string;
  }>;
}

interface RoomItem {
  id: string;
  name: string;
  code: string | null;
  building: string | null;
}

interface Props {
  programId: string;
}

function ageRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return "—";
  if (min !== null && max !== null) return `${min}–${max}`;
  if (min !== null) return `${min}+`;
  return `≤${max}`;
}

export function ProgramDetail({ programId }: Props) {
  const { t } = useTerminology();

  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [editProgramOpen, setEditProgramOpen] = useState(false);
  const [classFormOpen, setClassFormOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ProgramDetail["classes"][number] | null>(null);
  const [deletingClass, setDeletingClass] = useState<ProgramDetail["classes"][number] | null>(null);

  // Edit program form state
  const [progName, setProgName] = useState("");
  const [progDescription, setProgDescription] = useState("");
  const [progColor, setProgColor] = useState("");
  const [progSort, setProgSort] = useState(0);
  const [progSaving, setProgSaving] = useState(false);

  // Class form state
  const [cName, setCName] = useState("");
  const [cAgeMin, setCAgeMin] = useState<string>("");
  const [cAgeMax, setCAgeMax] = useState<string>("");
  const [cGrade, setCGrade] = useState("");
  const [cRoomId, setCRoomId] = useState<string>("__none__");
  const [cSort, setCSort] = useState(0);
  const [cDesc, setCDesc] = useState("");
  const [cSaving, setCSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [progRes, roomsRes] = await Promise.all([
        fetch(`/api/admin/programs/${programId}`, { cache: "no-store" }),
        fetch("/api/admin/rooms", { cache: "no-store" }),
      ]);
      if (!progRes.ok) throw new Error(`program status ${progRes.status}`);
      const prog = (await progRes.json()) as ProgramDetail;
      setProgram(prog);
      // Rooms may 401/etc; degrade gracefully.
      if (roomsRes.ok) {
        const roomsData = (await roomsRes.json()) as { items: RoomItem[] };
        setRooms(roomsData.items);
      }
    } catch (e) {
      toast.error("Failed to load program", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditProgram = () => {
    if (!program) return;
    setProgName(program.name);
    setProgDescription(program.description ?? "");
    setProgColor(program.color ?? "");
    setProgSort(program.sortOrder);
    setEditProgramOpen(true);
  };

  const handleSaveProgram = async () => {
    setProgSaving(true);
    try {
      const res = await fetch(`/api/admin/programs/${programId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: progName.trim(),
          description: progDescription.trim() || null,
          color: progColor.trim() || null,
          sortOrder: Number(progSort) || 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Program updated");
      setEditProgramOpen(false);
      void load();
    } catch (e) {
      toast.error("Failed to save program", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setProgSaving(false);
    }
  };

  const openAddClass = () => {
    setEditingClass(null);
    setCName("");
    setCAgeMin("");
    setCAgeMax("");
    setCGrade("");
    setCRoomId("__none__");
    setCSort(0);
    setCDesc("");
    setClassFormOpen(true);
  };

  const openEditClass = (c: ProgramDetail["classes"][number]) => {
    setEditingClass(c);
    setCName(c.name);
    setCAgeMin(c.ageMin !== null ? String(c.ageMin) : "");
    setCAgeMax(c.ageMax !== null ? String(c.ageMax) : "");
    setCGrade(c.gradeLevel ?? "");
    setCRoomId(c.room?.id ?? "__none__");
    setCSort(c.sortOrder);
    setCDesc(c.description ?? "");
    setClassFormOpen(true);
  };

  const handleSaveClass = async () => {
    setCSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: cName.trim(),
        description: cDesc.trim() || null,
        ageMin: cAgeMin.trim() === "" ? null : Number(cAgeMin),
        ageMax: cAgeMax.trim() === "" ? null : Number(cAgeMax),
        gradeLevel: cGrade.trim() || null,
        roomId: cRoomId === "__none__" ? null : cRoomId,
        sortOrder: Number(cSort) || 0,
      };
      if (editingClass) {
        const res = await fetch(
          `/api/admin/programs/${programId}/classes/${editingClass.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `status ${res.status}`);
        }
        toast.success("Class updated");
      } else {
        const res = await fetch(`/api/admin/programs/${programId}/classes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `status ${res.status}`);
        }
        toast.success("Class created");
      }
      setClassFormOpen(false);
      void load();
    } catch (e) {
      toast.error("Failed to save class", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setCSaving(false);
    }
  };

  const handleAssignRoom = async (
    classId: string,
    roomId: string | null,
  ) => {
    try {
      const res = await fetch(
        `/api/admin/programs/${programId}/classes/${classId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Room assigned");
      void load();
    } catch (e) {
      toast.error("Failed to assign room", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleDeleteClass = async () => {
    if (!deletingClass) return;
    try {
      const res = await fetch(
        `/api/admin/programs/${programId}/classes/${deletingClass.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(`${deletingClass.name} archived.`);
      setDeletingClass(null);
      void load();
    } catch (e) {
      toast.error("Failed to delete class", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="inline h-5 w-5 animate-spin mr-2" /> Loading program…
      </div>
    );
  }

  if (!program) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Program not found.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Program header */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-2xl flex items-center gap-2">
                {program.color && (
                  <span
                    className="inline-block h-4 w-4 rounded-full"
                    style={{ backgroundColor: program.color }}
                    aria-hidden
                  />
                )}
                {program.name}
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                {program.slug}
              </CardDescription>
              {program.description && (
                <p className="text-sm text-muted-foreground pt-1">
                  {program.description}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {program.isDefault && (
                  <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-200">
                    Default
                  </Badge>
                )}
                <Badge variant={program.isActive ? "default" : "destructive"}>
                  {program.isActive ? "Active" : "Archived"}
                </Badge>
                <Badge variant="outline">
                  {program.classes.length}{" "}
                  {program.classes.length === 1 ? t("group") : t("group_plural")}
                </Badge>
              </div>
            </div>
            <Button variant="outline" onClick={openEditProgram}>
              <PencilLine className="mr-1.5 h-4 w-4" /> Edit program
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Classes section */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{t("group_plural")}</CardTitle>
            <CardDescription>
              Add classes/divisions, assign rooms and review schedules.
            </CardDescription>
          </div>
          <Button onClick={openAddClass}>
            <Plus className="mr-1.5 h-4 w-4" /> Add {t("group").toLowerCase()}
          </Button>
        </CardHeader>
        <CardContent>
          {program.classes.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              No classes yet. Click{" "}
              <span className="font-medium text-foreground">
                Add {t("group").toLowerCase()}
              </span>{" "}
              to create the first one.
            </div>
          ) : (
            <div className="rounded-lg border">
              <div className="max-h-[60vh] overflow-y-auto scroll-thin">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-[90px]">Age</TableHead>
                      <TableHead className="w-[110px]">Grade</TableHead>
                      <TableHead className="w-[200px]">{t("room")}</TableHead>
                      <TableHead className="w-[200px]">
                        <Clock className="inline h-3 w-3 mr-1" />
                        Schedule
                      </TableHead>
                      <TableHead className="w-[100px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {program.classes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="font-medium">{c.name}</div>
                          {c.isDefault && (
                            <Badge
                              className="mt-1 bg-amber-50 text-amber-900 hover:bg-amber-100 text-[10px]"
                            >
                              Default
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {ageRange(c.ageMin, c.ageMax)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {c.gradeLevel ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={c.room?.id ?? "__none__"}
                            onValueChange={(v) =>
                              void handleAssignRoom(
                                c.id,
                                v === "__none__" ? null : v,
                              )
                            }
                          >
                            <SelectTrigger className="h-8 text-xs" aria-label={`Assign room for ${c.name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">
                                <span className="text-muted-foreground">— no room —</span>
                              </SelectItem>
                              {rooms.map((r) => (
                                <SelectItem key={r.id} value={r.id}>
                                  {r.name}
                                  {r.code ? ` (${r.code})` : ""}
                                  {r.building ? ` · ${r.building}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.scheduleSummary}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${c.name}`}
                              onClick={() => openEditClass(c)}
                            >
                              <PencilLine className="h-4 w-4" />
                            </Button>
                            <AlertDialog
                              open={deletingClass?.id === c.id}
                              onOpenChange={(o) =>
                                setDeletingClass(o ? c : null)
                              }
                            >
                              <button
                                type="button"
                                onClick={() => setDeletingClass(c)}
                                aria-label={`Archive ${c.name}`}
                                className="inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Archive {c.name}?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This soft-deletes the class. Its schedules are
                                    preserved for audit. You can restore it later
                                    from the API.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => void handleDeleteClass()}
                                  >
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
        </CardContent>
      </Card>

      {/* Edit program dialog */}
      <Dialog open={editProgramOpen} onOpenChange={setEditProgramOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit program</DialogTitle>
            <DialogDescription>
              The slug cannot be changed after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ep-name">Name</Label>
              <Input
                id="ep-name"
                value={progName}
                onChange={(e) => setProgName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-desc">Description</Label>
              <Textarea
                id="ep-desc"
                value={progDescription}
                onChange={(e) => setProgDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ep-color">Accent colour</Label>
                <Input
                  id="ep-color"
                  value={progColor}
                  onChange={(e) => setProgColor(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-sort">Sort order</Label>
                <Input
                  id="ep-sort"
                  type="number"
                  value={progSort}
                  onChange={(e) => setProgSort(Number(e.target.value))}
                  min={0}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditProgramOpen(false)}
              disabled={progSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSaveProgram()}
              disabled={progSaving || !progName.trim()}
            >
              {progSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Class create/edit dialog */}
      <Dialog open={classFormOpen} onOpenChange={setClassFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingClass ? `Edit ${editingClass.name}` : `Add ${t("group").toLowerCase()}`}
            </DialogTitle>
            <DialogDescription>
              {editingClass
                ? "Update the class details and room assignment."
                : "Create a new class/division within this program."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Name</Label>
              <Input
                id="c-name"
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                placeholder="e.g. Beginner, Kindergarten, Friend…"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-agemin">Age min</Label>
                <Input
                  id="c-agemin"
                  type="number"
                  min={0}
                  max={130}
                  value={cAgeMin}
                  onChange={(e) => setCAgeMin(e.target.value)}
                  placeholder="—"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-agemax">Age max</Label>
                <Input
                  id="c-agemax"
                  type="number"
                  min={0}
                  max={130}
                  value={cAgeMax}
                  onChange={(e) => setCAgeMax(e.target.value)}
                  placeholder="—"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-grade">Grade</Label>
                <Input
                  id="c-grade"
                  value={cGrade}
                  onChange={(e) => setCGrade(e.target.value)}
                  placeholder="e.g. Grade 5"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-room">{t("room")}</Label>
                <Select value={cRoomId} onValueChange={setCRoomId}>
                  <SelectTrigger id="c-room" aria-label="Assign room">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">— no room —</span>
                    </SelectItem>
                    {rooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                        {r.code ? ` (${r.code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-sort">Sort order</Label>
                <Input
                  id="c-sort"
                  type="number"
                  min={0}
                  value={cSort}
                  onChange={(e) => setCSort(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-desc">Description</Label>
              <Textarea
                id="c-desc"
                value={cDesc}
                onChange={(e) => setCDesc(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClassFormOpen(false)}
              disabled={cSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSaveClass()}
              disabled={cSaving || !cName.trim()}
            >
              {cSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editingClass ? "Save changes" : "Create class"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
