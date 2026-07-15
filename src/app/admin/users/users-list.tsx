"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  KeyRound,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  Unlock,
  UserMinus,
  UserPlus,
} from "lucide-react";

import { ROLE_PERMISSIONS } from "@/lib/auth";
import {
  ALL_STAFF_ROLES,
  LOGIN_REQUIRED_ROLES,
} from "@/lib/person-roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UserRow {
  id: string;
  personId: string;
  username: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    email: string | null;
    personType: string;
  } | null;
}

interface PersonInRole {
  id: string;
  name: string;
  personType: string;
  hasLogin: boolean;
}

interface Props {
  currentUserId: string;
  currentUsername: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(mo / 12);
  return `${yr}y ago`;
}

export function UsersList({ currentUserId, currentUsername }: Props) {
  // "All" view: list login accounts. Role-filter view: list people in a role.
  const [roleFilter, setRoleFilter] = useState<string | null>(null);

  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // Role-group view data
  const [rolePeople, setRolePeople] = useState<PersonInRole[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);
  const [addPersonOpen, setAddPersonOpen] = useState(false);

  // Dialog state
  const [pwdTarget, setPwdTarget] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: UserRow[] };
      setItems(data.items);
    } catch (e) {
      toast.error("Failed to load users", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRolePeople = useCallback(async (role: string) => {
    setRoleLoading(true);
    try {
      const res = await fetch(`/api/admin/roles/people?role=${role}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: PersonInRole[] };
      setRolePeople(data.items);
    } catch (e) {
      toast.error("Failed to load people in role", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setRoleLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (roleFilter) void loadRolePeople(roleFilter);
    else setRolePeople([]);
  }, [roleFilter, loadRolePeople]);

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const needle = q.trim().toLowerCase();
    return items.filter((u) => {
      const name =
        u.person
          ? `${u.person.firstName} ${u.person.lastName}`.toLowerCase()
          : "";
      return (
        name.includes(needle) || u.username.toLowerCase().includes(needle)
      );
    });
  }, [items, q]);

  // ---- Toggle status (enable/disable) ----------------------------------

  const toggleStatus = async (user: UserRow) => {
    const next = user.status === "Active" ? "Disabled" : "Active";
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(next === "Active" ? "User enabled" : "User disabled");
      await load();
    } catch (e) {
      toast.error("Failed to change status", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  // ---- Role-group: remove a person from the role -----------------------

  const removeFromRole = async (personId: string) => {
    if (!roleFilter) return;
    try {
      const res = await fetch("/api/admin/roles/assign", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, role: roleFilter }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Removed from role");
      await loadRolePeople(roleFilter);
    } catch (e) {
      toast.error("Failed to remove role", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const chips = [null, ...(ALL_STAFF_ROLES as readonly string[])];

  return (
    <div className="space-y-4">
      {/* Role-group chip row */}
      <div className="flex flex-wrap gap-2">
        {chips.map((r) => (
          <button
            key={r ?? "all"}
            onClick={() => setRoleFilter(r)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              roleFilter === r
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted/50"
            }`}
          >
            {r ?? "All logins"}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={
              roleFilter
                ? "Filter people in this role…"
                : "Search by name or username…"
            }
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
            aria-label="Search"
          />
        </div>
        {roleFilter && (
          <Button onClick={() => setAddPersonOpen(true)} size="sm">
            <UserPlus className="mr-1.5 h-4 w-4" /> Add person to {roleFilter}
          </Button>
        )}
        <div className="text-xs text-muted-foreground sm:ml-auto sm:px-2">
          {roleFilter
            ? `${rolePeople.length} in role`
            : `${items.length} login${items.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {roleFilter ? (
        /* ---- Role-group view: people in this role ---- */
        <div className="rounded-lg border bg-card">
          <div className="max-h-[70vh] overflow-y-auto scroll-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[140px]">Type</TableHead>
                  <TableHead className="w-[140px]">Login</TableHead>
                  <TableHead className="w-[160px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roleLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                      <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rolePeople.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                      No people have the {roleFilter} role yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rolePeople
                    .filter((p) =>
                      q.trim()
                        ? p.name.toLowerCase().includes(q.trim().toLowerCase())
                        : true,
                    )
                    .map((p) => (
                      <TableRow key={p.id} className="hover:bg-muted/40">
                        <TableCell>
                          <Link
                            href={`/admin/people/${p.id}`}
                            className="font-medium hover:underline"
                          >
                            {p.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.personType}
                        </TableCell>
                        <TableCell>
                          {p.hasLogin ? (
                            <Badge variant="outline" className="gap-1">
                              <Check className="h-3 w-3" /> yes
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void removeFromRole(p.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <UserMinus className="mr-1.5 h-4 w-4" /> Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        /* ---- All-logins view ---- */
        <div className="rounded-lg border bg-card">
          <div className="max-h-[70vh] overflow-y-auto scroll-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[160px]">Username</TableHead>
                  <TableHead className="w-[110px]">Status</TableHead>
                  <TableHead className="w-[120px]">Last login</TableHead>
                  <TableHead className="w-[240px] text-right">Actions</TableHead>
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
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                      No users match your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((u) => {
                    const isSelf = u.id === currentUserId;
                    const isActive = u.status === "Active";
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/40">
                        <TableCell>
                          {u.person ? (
                            <Link
                              href={`/admin/people/${u.person.id}`}
                              className="font-medium hover:underline"
                            >
                              {u.person.firstName} {u.person.lastName}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground italic">
                              (no person linked)
                            </span>
                          )}
                          {isSelf && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground">
                              (you)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {u.username}
                        </TableCell>
                        <TableCell>
                          {isActive ? (
                            <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-200">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="destructive">Disabled</Badge>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-xs text-muted-foreground"
                          title={u.lastLoginAt ?? "Never logged in"}
                        >
                          {relativeTime(u.lastLoginAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPwdTarget(u)}
                            >
                              <KeyRound className="mr-1.5 h-4 w-4" /> Password
                            </Button>
                            <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 h-8 ml-1">
                              <Switch
                                id={`status-${u.id}`}
                                checked={isActive}
                                onCheckedChange={() => void toggleStatus(u)}
                                aria-label={
                                  isActive
                                    ? `Disable ${u.username}`
                                    : `Enable ${u.username}`
                                }
                                disabled={isSelf && isActive}
                              />
                              <Label
                                htmlFor={`status-${u.id}`}
                                className="text-xs cursor-pointer"
                              >
                                {isActive ? (
                                  <Unlock className="h-3.5 w-3.5 text-emerald-700" />
                                ) : (
                                  <Lock className="h-3.5 w-3.5 text-destructive" />
                                )}
                              </Label>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Roles &amp; guardian PIN are managed per-person on the{" "}
        <Link href="/admin/people" className="underline">People</Link> page.
      </p>

      {/* Reset password dialog */}
      {pwdTarget && (
        <ResetPasswordDialog
          key={`pwd-${pwdTarget.id}`}
          user={pwdTarget}
          onClose={() => setPwdTarget(null)}
        />
      )}

      {/* Add person to role dialog */}
      {roleFilter && (
        <AddPersonToRoleDialog
          open={addPersonOpen}
          onOpenChange={setAddPersonOpen}
          role={roleFilter}
          onAdded={() => void loadRolePeople(roleFilter)}
        />
      )}
    </div>
  );
}

// =========================================================================
// Reset-password dialog
// =========================================================================

interface ResetPasswordDialogProps {
  user: UserRow;
  onClose: () => void;
}

function ResetPasswordDialog({ user, onClose }: ResetPasswordDialogProps) {
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (pwd.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (pwd !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Password reset", {
        description: `New password set for ${user.username}.`,
      });
      onClose();
    } catch (e) {
      toast.error("Failed to reset password", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Reset password — {user.username}
          </DialogTitle>
          <DialogDescription>
            Set a new password for this account. The user will need to use it
            on next sign-in. The previous password is overwritten.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rp-pwd" className="text-sm">
              New password <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rp-pwd"
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              autoComplete="new-password"
              maxLength={128}
            />
            <p className="text-xs text-muted-foreground">
              Minimum 8 characters.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-confirm" className="text-sm">
              Confirm password <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rp-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              maxLength={128}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>
        </div>

        <DialogFooter className="border-t pt-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="mr-1.5 h-4 w-4" />
            )}
            Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================================
// Add-person-to-role dialog (searches People, assigns the selected role)
// =========================================================================

interface AddPersonOption {
  id: string;
  firstName: string;
  lastName: string;
  personType: string;
}

function AddPersonToRoleDialog({
  open,
  onOpenChange,
  role,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role: string;
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AddPersonOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  // Admin/PeopleManager require a login — only offer people with a login.
  const loginRequired = LOGIN_REQUIRED_ROLES.has(role);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const h = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/people?q=${encodeURIComponent(q)}&pageSize=20`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { items: AddPersonOption[] };
        setResults(data.items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(h);
  }, [q]);

  const addPerson = async (personId: string) => {
    setAdding(personId);
    try {
      const res = await fetch("/api/admin/roles/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(`Added to ${role}`);
      onAdded();
      onOpenChange(false);
    } catch (e) {
      toast.error("Failed to assign role", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Add person to {role}
          </DialogTitle>
          <DialogDescription>
            Search for a person to grant the {role} role.
            {loginRequired && (
              <>
                {" "}
                <strong>Note:</strong> {role} requires a login account. If the
                person has none, create one first from their People detail page.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            placeholder="Search people by name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {searching && (
            <p className="text-xs text-muted-foreground flex items-center">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Searching…
            </p>
          )}
          {results.length > 0 && (
            <ul className="border rounded-md divide-y max-h-64 overflow-y-auto scroll-thin">
              {results.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 p-2 text-sm hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {p.firstName} {p.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">{p.personType}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={adding === p.id}
                    onClick={() => void addPerson(p.id)}
                  >
                    {adding === p.id ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="mr-1.5 h-4 w-4" />
                    )}
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
