"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface RoomItem {
  id: string;
  name: string;
  code: string | null;
  building: string | null;
}

interface PrinterSummary {
  id: string;
  name: string;
  driver: string;
  queueName: string | null;
  purpose: string;
  isDefault: boolean;
  isActive: boolean;
}

interface RoomAssignment {
  assignmentId: string;
  printer: PrinterSummary;
}

interface RoomWithAssignments {
  roomId: string;
  roomName: string;
  assignments: RoomAssignment[];
}

const DRIVER_LABELS: Record<string, string> = {
  browser: "Browser",
  qz_tray: "QZ Tray",
  thermal_raw: "Thermal raw",
};

/**
 * Room-assignments tab.
 *
 * For each room, show the printers assigned to it + a select to add another.
 * The same printer can be assigned to multiple rooms; per-room printer wins
 * over the default at print-time (see resolvePrinter in src/lib/printing.ts).
 */
export function RoomAssignmentsTab() {
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [printers, setPrinters] = useState<PrinterSummary[]>([]);
  const [assignmentsByRoom, setAssignmentsByRoom] = useState<Record<string, RoomAssignment[]>>({});
  const [loading, setLoading] = useState(true);
  const [pendingAdd, setPendingAdd] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roomsRes, printersRes] = await Promise.all([
        fetch("/api/admin/rooms?includeInactive=false", { cache: "no-store" }),
        fetch("/api/admin/printers?includeInactive=false", { cache: "no-store" }),
      ]);
      if (!roomsRes.ok || !printersRes.ok) {
        throw new Error("failed to load rooms / printers");
      }
      const roomsData = (await roomsRes.json()) as { items: RoomItem[] };
      const printersData = (await printersRes.json()) as { items: PrinterSummary[] };
      setRooms(roomsData.items);
      setPrinters(printersData.items);

      // Fetch assignments for every room in parallel.
      const assignmentResults = await Promise.all(
        roomsData.items.map(async (r) => {
          const res = await fetch(`/api/admin/rooms/${r.id}/printers`, { cache: "no-store" });
          if (!res.ok) return { roomId: r.id, items: [] as RoomAssignment[] };
          const data = (await res.json()) as { items: RoomAssignment[] };
          return { roomId: r.id, items: data.items };
        }),
      );
      const map: Record<string, RoomAssignment[]> = {};
      for (const a of assignmentResults) map[a.roomId] = a.items;
      setAssignmentsByRoom(map);
    } catch (e) {
      toast.error("Failed to load room assignments", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAssign = async (roomId: string) => {
    const printerId = pendingAdd[roomId];
    if (!printerId) {
      toast.error("Pick a printer first");
      return;
    }
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}/printers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printerId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Printer assigned");
      setPendingAdd((prev) => {
        const next = { ...prev };
        delete next[roomId];
        return next;
      });
      void load();
    } catch (e) {
      toast.error("Failed to assign printer", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleUnassign = async (roomId: string, printerId: string) => {
    try {
      const res = await fetch(
        `/api/admin/rooms/${roomId}/printers?printerId=${encodeURIComponent(printerId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Printer unassigned");
      void load();
    } catch (e) {
      toast.error("Failed to unassign printer", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="inline h-5 w-5 animate-spin mr-2" /> Loading room assignments…
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No rooms yet. Add rooms in{" "}
          <a href="/admin/rooms" className="underline">/admin/rooms</a> first.
        </CardContent>
      </Card>
    );
  }

  if (printers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No active printers yet. Add one in the{" "}
          <span className="font-medium text-foreground">Printers</span> tab first.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Room printer assignments</CardTitle>
        <CardDescription>
          Assign specific printers to rooms. At print time, a room-assigned
          printer takes priority over the org default. The same printer can be
          assigned to multiple rooms.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-card">
          <div className="max-h-[60vh] overflow-y-auto scroll-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead className="w-[200px]">Room</TableHead>
                  <TableHead>Assigned printers</TableHead>
                  <TableHead className="w-[280px] text-right">Add</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.map((r) => {
                  const assigned = assignmentsByRoom[r.id] ?? [];
                  const available = printers.filter(
                    (p) => !assigned.some((a) => a.printer.id === p.id),
                  );
                  return (
                    <TableRow key={r.id} className="hover:bg-muted/40 align-top">
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.code ? `Code ${r.code}` : ""}
                          {r.building ? ` · ${r.building}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        {assigned.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            No room-specific printer — falls back to default.
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {assigned.map((a) => (
                              <Badge
                                key={a.assignmentId}
                                variant="secondary"
                                className="gap-1 pr-1"
                              >
                                <span>{a.printer.name}</span>
                                <span className="text-[10px] opacity-70">
                                  · {DRIVER_LABELS[a.printer.driver] ?? a.printer.driver}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Unassign ${a.printer.name}`}
                                  onClick={() => void handleUnassign(r.id, a.printer.id)}
                                  className="ml-0.5 inline-flex items-center justify-center h-4 w-4 rounded hover:bg-destructive/20 hover:text-destructive"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <Select
                            value={pendingAdd[r.id] ?? ""}
                            onValueChange={(v) =>
                              setPendingAdd((prev) => ({ ...prev, [r.id]: v }))
                            }
                          >
                            <SelectTrigger className="h-9 w-[180px]">
                              <SelectValue
                                placeholder={
                                  available.length === 0
                                    ? "All printers assigned"
                                    : "Pick a printer…"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {available.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}{" "}
                                  <span className="text-xs opacity-70">
                                    ({DRIVER_LABELS[p.driver] ?? p.driver})
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="icon"
                            aria-label={`Assign printer to ${r.name}`}
                            disabled={!pendingAdd[r.id]}
                            onClick={() => void handleAssign(r.id)}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
