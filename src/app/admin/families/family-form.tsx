"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PersonOption {
  id: string;
  firstName: string;
  lastName: string;
  personType: string;
  email: string | null;
  phone: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

export function FamilyForm({ open, onOpenChange, onSaved }: Props) {
  const [familyName, setFamilyName] = useState("");
  const [notes, setNotes] = useState("");
  const [members, setMembers] = useState<PersonOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<PersonOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setFamilyName("");
      setNotes("");
      setMembers([]);
      setSearchQ("");
      setSearchResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const h = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/people?q=${encodeURIComponent(searchQ)}&pageSize=20`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { items: PersonOption[] };
        // Filter out already-added members.
        setSearchResults(
          data.items.filter((p) => !members.some((m) => m.id === p.id)),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(h);
  }, [searchQ, members]);

  const addMember = (p: PersonOption) => {
    if (members.some((m) => m.id === p.id)) return;
    setMembers([...members, p]);
    setSearchResults((prev) => prev.filter((x) => x.id !== p.id));
  };

  const removeMember = (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const handleSave = async () => {
    if (!familyName.trim()) {
      toast.error("Family name is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyName: familyName.trim(),
          notes: notes.trim() || null,
          memberIds: members.map((m) => m.id),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Family created");
      onSaved();
    } catch (e) {
      toast.error("Failed to create family", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create family</DialogTitle>
          <DialogDescription>
            A family groups primary carers and children. You can add members now
            or later from the family detail page.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto scroll-thin space-y-4 py-2">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">
                Family name<span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                maxLength={120}
                placeholder="e.g. Smith"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={4000}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Add members</Label>
            <p className="text-xs text-muted-foreground">
              Search for existing people. Adults are added as Primary Carers,
              children as Children. You can change roles later.
            </p>
            <Input
              placeholder="Search people by name…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searching && (
              <p className="text-xs text-muted-foreground flex items-center">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Searching…
              </p>
            )}
            {searchResults.length > 0 && (
              <ul className="border rounded-md divide-y max-h-48 overflow-y-auto scroll-thin">
                {searchResults.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 p-2 text-sm hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {p.firstName} {p.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.personType === "Child" ? "Child" : "Adult"}
                        {p.email ? ` · ${p.email}` : ""}
                        {p.phone ? ` · ${p.phone}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => addMember(p)}
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {members.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Members to add:</p>
                <ul className="space-y-1">
                  {members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-medium">
                          {m.firstName} {m.lastName}
                        </span>{" "}
                        <Badge variant="outline" className="ml-1">
                          {m.personType === "Child" ? "Child" : "PrimaryCarer"}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeMember(m.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t pt-3">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Create family
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
