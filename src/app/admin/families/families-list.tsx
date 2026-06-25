"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Plus,
  Search,
} from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FamilyForm } from "./family-form";

interface FamilyRow {
  id: string;
  familyName: string;
  isActive: boolean;
  memberCount: number;
  primaryCarers: string[];
  childrenCount: number;
  notes: string | null;
}

export function FamiliesList() {
  const { t } = useTerminology();
  const [items, setItems] = useState<FamilyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);

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
      const res = await fetch(`/api/admin/families?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: FamilyRow[]; total: number };
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      toast.error("Failed to load families", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedQ]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={`Search ${t("family_plural").toLowerCase()} by name or member…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
            aria-label="Search families"
          />
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Add {t("family").toLowerCase()}
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="max-h-[70vh] overflow-y-auto scroll-thin">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead>{t("family")}</TableHead>
                <TableHead className="w-[280px]">{t("carer_plural")}</TableHead>
                <TableHead className="w-[100px]">{t("child_plural")}</TableHead>
                <TableHead className="w-[80px]">Members</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                    Loading…
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    No {t("family_plural").toLowerCase()} found. Click{" "}
                    <span className="font-medium">Add {t("family").toLowerCase()}</span>{" "}
                    to create one.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((f) => (
                  <TableRow key={f.id} className="hover:bg-muted/40">
                    <TableCell>
                      <Link
                        href={`/admin/families/${f.id}`}
                        className="font-medium hover:underline"
                      >
                        {f.familyName}
                      </Link>
                      {f.notes && (
                        <p className="text-xs text-muted-foreground truncate max-w-xs">
                          {f.notes}
                        </p>
                      )}
                      {!f.isActive && (
                        <Badge variant="destructive" className="ml-2">
                          Archived
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.primaryCarers.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        f.primaryCarers.join(", ")
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{f.childrenCount}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{f.memberCount}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="icon" aria-label="View">
                        <Link href={`/admin/families/${f.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

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

      <FamilyForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => {
          setFormOpen(false);
          void load();
        }}
      />
    </div>
  );
}
