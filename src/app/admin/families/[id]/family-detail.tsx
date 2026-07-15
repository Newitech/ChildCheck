"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  PencilLine,
  Save,
  UserPlus,
  X,
} from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { useFlags } from "@/hooks/use-flags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { FamilyAuthorisedGuardiansSection } from "./authorised-guardians-section";
import { FamilyBlacklistSection } from "./blacklist-section";
import { FamilyOlderSiblingSection } from "./older-sibling-section";

interface Member {
  id: string;
  role: string;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    personType: string;
    email: string | null;
    phone: string | null;
    hasPhoto: boolean;
    isVisitor: boolean;
    isActive: boolean;
  };
}

interface FamilyDetailDTO {
  id: string;
  familyName: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  members: Member[];
}

interface Props {
  initial: FamilyDetailDTO;
}

const ROLES = ["PrimaryCarer", "Child", "EmergencyContact"];

export function FamilyDetail({ initial }: Props) {
  const router = useRouter();
  const { t } = useTerminology();
  const { isEnabled } = useFlags();
  const [data, setData] = useState<FamilyDetailDTO>(initial);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(initial.familyName);
  const [editNotes, setEditNotes] = useState(initial.notes ?? "");
  const [saving, setSaving] = useState(false);

  // Add-member search
  const [addQ, setAddQ] = useState("");
  const [addRole, setAddRole] = useState<string>("PrimaryCarer");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<
    { id: string; firstName: string; lastName: string; personType: string; email: string | null }[]
  >([]);
  const [adding, setAdding] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch(`/api/admin/families/${data.id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const d = (await res.json()) as FamilyDetailDTO;
      setData(d);
    } catch (e) {
      toast.error("Failed to refresh", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  useEffect(() => {
    setEditName(initial.familyName);
    setEditNotes(initial.notes ?? "");
  }, [initial]);

  useEffect(() => {
    if (!addQ.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const h = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/people?q=${encodeURIComponent(addQ)}&pageSize=20`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as {
          items: { id: string; firstName: string; lastName: string; personType: string; email: string | null }[];
        };
        // Filter out people who are already members of this family.
        setSearchResults(
          body.items.filter(
            (p) => !data.members.some((m) => m.person.id === p.id),
          ),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(h);
  }, [addQ, data.members]);

  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      toast.error("Family name is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/families/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyName: editName.trim(),
          notes: editNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Family updated");
      setEditing(false);
      await refresh();
      router.refresh();
    } catch (e) {
      toast.error("Failed to save", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async (personId: string) => {
    setAdding(true);
    try {
      const res = await fetch(`/api/admin/families/${data.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, role: addRole }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Member added");
      setAddQ("");
      setSearchResults([]);
      await refresh();
    } catch (e) {
      toast.error("Failed to add member", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMember = async (personId: string, name: string) => {
    try {
      const res = await fetch(
        `/api/admin/families/${data.id}/members/${personId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(`${name} removed from family`);
      await refresh();
    } catch (e) {
      toast.error("Failed to remove member", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleArchive = async () => {
    try {
      const res = await fetch(`/api/admin/families/${data.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Family archived");
      router.push("/admin/families");
      router.refresh();
    } catch (e) {
      toast.error("Failed to archive", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const groups: Record<string, Member[]> = {
    PrimaryCarer: [],
    Child: [],
    EmergencyContact: [],
  };
  for (const m of data.members) {
    // AuthorisedGuardian is rendered in a dedicated section below — exclude
    // it from the generic members grid.
    if (m.role === "AuthorisedGuardian") continue;
    if (!groups[m.role]) groups[m.role] = [];
    groups[m.role].push(m);
  }

  // Children of this family — passed to the Blacklist + Older-sibling sections.
  const children = data.members
    .filter((m) => m.role === "Child")
    .map((m) => ({
      id: m.person.id,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
    }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            {editing ? (
              <div className="space-y-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="text-lg font-semibold h-9"
                  maxLength={120}
                />
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                  maxLength={4000}
                  placeholder="Notes (optional)"
                />
              </div>
            ) : (
              <>
                <CardTitle className="text-xl">{data.familyName}</CardTitle>
                <CardDescription className="mt-1">
                  Created {new Date(data.createdAt).toLocaleDateString()}
                  {!data.isActive && " · ARCHIVED"}
                </CardDescription>
                {data.notes && (
                  <p className="text-sm mt-2 text-muted-foreground">{data.notes}</p>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setEditName(data.familyName);
                    setEditNotes(data.notes ?? "");
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void handleSaveEdit()} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 h-4 w-4" />
                  )}
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <PencilLine className="mr-1.5 h-4 w-4" /> Edit
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      Archive
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Archive this family?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Soft-deletes the family (isActive=false). Member persons
                        are not affected. This action cannot be undone from the UI.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleArchive()}>
                        Archive
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Add-member panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Add member
          </CardTitle>
          <CardDescription>
            Search an existing person and pick a role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-[1fr_180px] gap-2">
            <Input
              placeholder="Search people…"
              value={addQ}
              onChange={(e) => setAddQ(e.target.value)}
            />
            <Select value={addRole} onValueChange={setAddRole}>
              <SelectTrigger aria-label="Member role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r === "PrimaryCarer" ? t("carer") : r === "Child" ? t("child") : r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                      {p.personType === "Child" ? t("child") : "Adult"}
                      {p.email ? ` · ${p.email}` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={adding}
                    onClick={() => void handleAddMember(p.id)}
                  >
                    Add as {addRole === "PrimaryCarer" ? t("carer") : addRole === "Child" ? t("child") : addRole}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Members grouped by role */}
      <div className="grid sm:grid-cols-2 gap-4">
        {(["PrimaryCarer", "Child", "EmergencyContact"] as const).map((role) => {
          const list = groups[role] ?? [];
          if (list.length === 0) return null;
          const title =
            role === "PrimaryCarer"
              ? t("carer_plural")
              : role === "Child"
                ? t("child_plural")
                : "Emergency Contacts";
          return (
            <Card key={role}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{title}</span>
                  <Badge variant="outline">{list.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {list.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-start justify-between gap-3 rounded-md border p-2"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <img
                        src={`/api/people/${m.person.id}/photo`}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover bg-muted flex-shrink-0"
                        loading="lazy"
                      />
                      <div className="min-w-0">
                        <Link
                          href={`/admin/people/${m.person.id}`}
                          className="font-medium hover:underline"
                        >
                          {m.person.firstName} {m.person.lastName}
                        </Link>
                        {m.person.preferredName && (
                          <p className="text-xs text-muted-foreground">
                            &ldquo;{m.person.preferredName}&rdquo;
                          </p>
                        )}
                        {m.person.email && (
                          <p className="text-xs text-muted-foreground truncate">
                            {m.person.email}
                          </p>
                        )}
                        {m.person.phone && (
                          <p className="text-xs text-muted-foreground">{m.person.phone}</p>
                        )}
                        {!m.person.isActive && (
                          <Badge variant="destructive" className="mt-1">
                            Archived
                          </Badge>
                        )}
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove from family"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Remove {m.person.firstName} {m.person.lastName} from {data.familyName}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes their membership in this family. The
                            person record itself is not affected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              void handleRemoveMember(
                                m.person.id,
                                `${m.person.firstName} ${m.person.lastName}`,
                              )
                            }
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {data.members.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No members yet. Use the &ldquo;Add member&rdquo; panel above to add
            carers and children.
          </CardContent>
        </Card>
      )}

      {/* Stage 4 sections: Authorised Guardians, Blacklist, Older-sibling */}
      <FamilyAuthorisedGuardiansSection
        familyId={data.id}
        familyName={data.familyName}
        canEdit={data.isActive}
      />

      <FamilyBlacklistSection
        familyId={data.id}
        familyName={data.familyName}
        childMembers={children}
        canEdit={data.isActive}
      />

      {isEnabled("older_sibling_collect") && (
        <FamilyOlderSiblingSection
          familyId={data.id}
          familyName={data.familyName}
          childMembers={children}
          canEdit={data.isActive}
        />
      )}
    </div>
  );
}
