"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  PencilLine,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { useFlags } from "@/hooks/use-flags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PersonForm } from "./person-form";
import { formatFullName, type PersonListDTO } from "@/lib/people";

interface Props {
  currentUserId: string;
}

export function PeopleList({ currentUserId }: Props) {
  const router = useRouter();
  const { t } = useTerminology();
  const { isEnabled } = useFlags();
  const wwccEnabled = isEnabled("working_with_children_tracking");

  const [items, setItems] = useState<PersonListDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [personType, setPersonType] = useState<"all" | "Adult" | "Child">("all");
  const [visitorsOnly, setVisitorsOnly] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PersonListDTO | null>(null);
  const [deleting, setDeleting] = useState<PersonListDTO | null>(null);

  // Debounce search input.
  useEffect(() => {
    const h = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedQ) params.set("q", debouncedQ);
      if (personType !== "all") params.set("personType", personType);
      if (visitorsOnly) params.set("isVisitor", "true");
      if (includeInactive) params.set("includeInactive", "true");
      const res = await fetch(`/api/admin/people?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: PersonListDTO[]; total: number };
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      toast.error("Failed to load people", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedQ, personType, visitorsOnly, includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/admin/people/${deleting.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(`${formatFullName(deleting)} archived.`);
      setDeleting(null);
      void load();
    } catch (e) {
      toast.error("Failed to delete person", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email or phone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
            aria-label="Search people"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={personType}
            onValueChange={(v) => {
              setPersonType(v as "all" | "Adult" | "Child");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[140px]" aria-label="Filter by person type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="Adult">Adults</SelectItem>
              <SelectItem value="Child">{t("child_plural")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 h-9">
            <Switch
              id="visitors-only"
              checked={visitorsOnly}
              onCheckedChange={(v) => {
                setVisitorsOnly(v);
                setPage(1);
              }}
              aria-label="Visitors only"
            />
            <Label htmlFor="visitors-only" className="text-xs cursor-pointer">
              Visitors
            </Label>
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 h-9">
            <Switch
              id="include-inactive"
              checked={includeInactive}
              onCheckedChange={(v) => {
                setIncludeInactive(v);
                setPage(1);
              }}
              aria-label="Include archived"
            />
            <Label htmlFor="include-inactive" className="text-xs cursor-pointer">
              Archived
            </Label>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            size="default"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add person
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <div className="max-h-[70vh] overflow-y-auto scroll-thin">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="w-[60px]">Photo</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-[100px]">Type</TableHead>
                <TableHead className="w-[200px]">Contact</TableHead>
                <TableHead className="w-[90px]">{t("family_plural")}</TableHead>
                {wwccEnabled && (
                  <TableHead className="w-[110px]">WWCC</TableHead>
                )}
                <TableHead className="w-[80px]">Status</TableHead>
                <TableHead className="w-[160px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={wwccEnabled ? 8 : 7} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                    Loading…
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={wwccEnabled ? 8 : 7} className="py-12 text-center text-muted-foreground">
                    No people found. Click <span className="font-medium">Add person</span> to create your first record.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/40">
                    <TableCell>
                      <img
                        src={`/api/people/${p.id}/photo`}
                        alt=""
                        className="h-9 w-9 rounded-full object-cover bg-muted"
                        loading="lazy"
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/people/${p.id}`}
                        className="font-medium hover:underline"
                      >
                        {formatFullName(p)}
                      </Link>
                      {p.preferredName && (
                        <span className="block text-xs text-muted-foreground">
                          &ldquo;{p.preferredName}&rdquo;
                        </span>
                      )}
                      {p.ageInfo && (
                        <span className="block text-xs text-muted-foreground">
                          Age {p.ageInfo.ageYears}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.personType === "Child" ? "default" : "secondary"}>
                        {p.personType === "Child" ? t("child") : "Adult"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.email && <div className="truncate">{p.email}</div>}
                      {p.phone && (
                        <div className="text-xs text-muted-foreground">{p.phone}</div>
                      )}
                      {!p.email && !p.phone && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.familyCount}</Badge>
                    </TableCell>
                    {wwccEnabled && (
                      <TableCell>
                        {p.wwccStatusSummary ? (
                          <WwccBadge status={p.wwccStatusSummary} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {p.isVisitor && (
                        <Badge variant="outline" className="mr-1">
                          Visitor
                        </Badge>
                      )}
                      {!p.isActive && (
                        <Badge variant="destructive">Archived</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button asChild variant="ghost" size="icon" aria-label="View">
                          <Link href={`/admin/people/${p.id}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit"
                          onClick={() => {
                            setEditing(p);
                            setFormOpen(true);
                          }}
                        >
                          <PencilLine className="h-4 w-4" />
                        </Button>
                        <AlertDialog
                          open={deleting?.id === p.id}
                          onOpenChange={(o) => setDeleting(o ? p : null)}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete"
                              disabled={p.id === currentUserId}
                              title={
                                p.id === currentUserId
                                  ? "You can't delete your own person record while logged in"
                                  : "Archive person"
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Archive {formatFullName(p)}?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This soft-deletes the record (sets <code>isActive=false</code>).
                                The person will disappear from the default list but remain in
                                the database for audit and child-safety purposes. This action
                                cannot be undone from the UI.
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
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <div>
          Showing{" "}
          <span className="font-medium text-foreground">
            {items.length === 0 ? 0 : (page - 1) * pageSize + 1}–
            {(page - 1) * pageSize + items.length}
          </span>{" "}
          of <span className="font-medium text-foreground">{total}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="px-2">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <PersonForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSaved={() => {
          setFormOpen(false);
          setEditing(null);
          void load();
          router.refresh();
        }}
      />
    </div>
  );
}

function WwccBadge({ status }: { status: string }) {
  if (status === "Verified")
    return <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-200">{status}</Badge>;
  if (status === "Expired")
    return <Badge variant="destructive">{status}</Badge>;
  if (status === "Cancelled")
    return <Badge variant="outline">{status}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}
