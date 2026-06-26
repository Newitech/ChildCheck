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
  UserCog,
} from "lucide-react";

import { ROLE_PERMISSIONS } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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

interface UserRow {
  id: string;
  personId: string;
  username: string;
  status: string;
  lastLoginAt: string | null;
  hasPin: boolean;
  createdAt: string;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    email: string | null;
    personType: string;
  } | null;
  roles: string[];
}

interface Props {
  currentUserId: string;
  currentUsername: string;
}

const KNOWN_ROLES = Object.keys(ROLE_PERMISSIONS);

const ROLE_DESCRIPTIONS: Record<string, string> = {
  Admin: "Full access to everything (bypasses all permission checks).",
  Security: "View roster, override checkout, view audit/people/programs.",
  Teacher: "Check in/out, override, headcount, reports, view programs.",
  Volunteer: "Check in/out, view roster, headcount, view programs.",
  Kiosk: "Operate the kiosk + view programs.",
  PeopleManager: "Manage people, families + view/manage programs.",
};

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

function roleBadgeVariant(role: string) {
  if (role === "Admin") return "default";
  return "secondary";
}

export function UsersList({ currentUserId, currentUsername }: Props) {
  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // Dialog state
  const [rolesTarget, setRolesTarget] = useState<UserRow | null>(null);
  const [pwdTarget, setPwdTarget] = useState<UserRow | null>(null);
  const [pinTarget, setPinTarget] = useState<UserRow | null>(null);

  // Self-lockout confirmation (removing own Admin role)
  const [selfLockoutPending, setSelfLockoutPending] =
    useState<UserRow | null>(null);

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

  useEffect(() => {
    void load();
  }, [load]);

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

  // ---- Edit roles -------------------------------------------------------

  const commitRoles = async (user: UserRow, roles: string[]) => {
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Roles updated");
      setRolesTarget(null);
      await load();
    } catch (e) {
      toast.error("Failed to update roles", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

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

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or username…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
            aria-label="Search users"
          />
        </div>
        <div className="text-xs text-muted-foreground sm:ml-auto sm:px-2">
          {items.length} user{items.length === 1 ? "" : "s"} total
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <div className="max-h-[70vh] overflow-y-auto scroll-thin">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[160px]">Username</TableHead>
                <TableHead className="w-[240px]">Roles</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[110px]">PIN</TableHead>
                <TableHead className="w-[120px]">Last login</TableHead>
                <TableHead className="w-[260px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                    Loading…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
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
                        <div className="flex flex-wrap gap-1">
                          {u.roles.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            u.roles
                              .slice()
                              .sort((a, b) => a.localeCompare(b))
                              .map((r) => (
                                <Badge
                                  key={r}
                                  variant={roleBadgeVariant(r)}
                                  className="text-[10px]"
                                >
                                  {r}
                                </Badge>
                              ))
                          )}
                        </div>
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
                      <TableCell>
                        {u.hasPin ? (
                          <Badge variant="outline" className="gap-1">
                            <KeyRound className="h-3 w-3" /> Set
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
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
                            onClick={() => setRolesTarget(u)}
                          >
                            <UserCog className="mr-1.5 h-4 w-4" /> Roles
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPwdTarget(u)}
                          >
                            <KeyRound className="mr-1.5 h-4 w-4" /> Password
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPinTarget(u)}
                          >
                            <Lock className="mr-1.5 h-4 w-4" /> PIN
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

      {/* Edit-roles dialog — keyed by user id so it remounts fresh each open */}
      {rolesTarget && (
        <EditRolesDialog
          key={`roles-${rolesTarget.id}`}
          user={rolesTarget}
          currentUserId={currentUserId}
          onClose={() => setRolesTarget(null)}
          onSave={(roles) => {
            if (!rolesTarget) return;
            // Self-lockout guard: if removing Admin from yourself, confirm first.
            const wasAdmin = rolesTarget.roles.includes("Admin");
            const willBeAdmin = roles.includes("Admin");
            if (
              rolesTarget.id === currentUserId &&
              wasAdmin &&
              !willBeAdmin
            ) {
              setSelfLockoutPending({ ...rolesTarget, roles });
              setRolesTarget(null);
              return;
            }
            void commitRoles(rolesTarget, roles);
          }}
        />
      )}

      {/* Self-lockout confirmation */}
      <AlertDialog
        open={selfLockoutPending !== null}
        onOpenChange={(o) => !o && setSelfLockoutPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Remove your own Admin role?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to remove the <strong>Admin</strong> role from your
              own account (<code>{currentUsername}</code>). You will lose
              access to <strong>this page</strong> and all admin functions.
              <br />
              <br />
              Continue only if you are transferring admin responsibility to
              another user — otherwise click Cancel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selfLockoutPending) {
                  void commitRoles(selfLockoutPending, selfLockoutPending.roles);
                }
                setSelfLockoutPending(null);
              }}
            >
              Yes, remove my Admin role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset password dialog */}
      {pwdTarget && (
        <ResetPasswordDialog
          key={`pwd-${pwdTarget.id}`}
          user={pwdTarget}
          onClose={() => setPwdTarget(null)}
        />
      )}

      {/* Set PIN dialog */}
      {pinTarget && (
        <SetPinDialog
          key={`pin-${pinTarget.id}`}
          user={pinTarget}
          onClose={() => setPinTarget(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

// =========================================================================
// Edit-roles dialog
// =========================================================================

interface EditRolesDialogProps {
  user: UserRow;
  currentUserId: string;
  onClose: () => void;
  onSave: (roles: string[]) => void;
}

function EditRolesDialog({
  user,
  currentUserId,
  onClose,
  onSave,
}: EditRolesDialogProps) {
  const [selected, setSelected] = useState<string[]>(user.roles.slice());

  const toggle = (role: string) => {
    setSelected((cur) =>
      cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role],
    );
  };

  const isSelfRemovingAdmin =
    user.id === currentUserId &&
    user.roles.includes("Admin") &&
    !selected.includes("Admin");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Edit roles — {user.username}
          </DialogTitle>
          <DialogDescription>
            {user.person
              ? `${user.person.firstName} ${user.person.lastName}`
              : ""}
            . Tick the roles this user should have. The full set replaces their
            current roles.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {KNOWN_ROLES.map((role) => {
            const checked = selected.includes(role);
            return (
              <label
                key={role}
                htmlFor={`role-${role}`}
                className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <Checkbox
                  id={`role-${role}`}
                  checked={checked}
                  onCheckedChange={() => toggle(role)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{role}</span>
                    {role === "Admin" && (
                      <Badge variant="default" className="text-[9px]">superuser</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {ROLE_DESCRIPTIONS[role]}
                  </p>
                </div>
              </label>
            );
          })}
        </div>

        {isSelfRemovingAdmin && (
          <div className="flex items-start gap-2 rounded-md border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <strong>Warning:</strong> You are removing your own Admin role.
              You will lose access to this page. You will be asked to confirm
              before the change is applied.
            </div>
          </div>
        )}

        <DialogFooter className="border-t pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(selected)}>
            <Check className="mr-1.5 h-4 w-4" /> Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
// Set-PIN dialog
// =========================================================================

interface SetPinDialogProps {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}

function SetPinDialog({ user, onClose, onSaved }: SetPinDialogProps) {
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (overridePin?: string) => {
    const value = overridePin ?? pin;
    // Empty string => clear
    if (value !== "" && !/^\d{4,6}$/.test(value)) {
      toast.error("PIN must be 4–6 digits.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/set-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(value === "" ? "PIN cleared" : "PIN set", {
        description:
          value === ""
            ? `PIN removed for ${user.username}.`
            : `PIN set for ${user.username}.`,
      });
      await onSaved();
      onClose();
    } catch (e) {
      toast.error("Failed to set PIN", {
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
            <Lock className="h-5 w-5 text-primary" />
            Set PIN — {user.username}
          </DialogTitle>
          <DialogDescription>
            A PIN lets the user sign in quickly at the kiosk using a 4–6 digit
            code. Leave blank + click Clear to remove an existing PIN.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pin-input" className="text-sm">
              PIN (4–6 digits)
            </Label>
            <Input
              id="pin-input"
              inputMode="numeric"
              pattern="\d*"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="e.g. 1234"
              autoComplete="off"
              maxLength={6}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Current status:{" "}
              {user.hasPin ? (
                <span className="text-emerald-700 font-medium">PIN set</span>
              ) : (
                <span className="text-muted-foreground">no PIN</span>
              )}
            </p>
          </div>
        </div>

        <DialogFooter className="border-t pt-3 flex-col sm:flex-row sm:justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => void submit("")}
            disabled={saving || !user.hasPin}
            className="sm:mr-auto text-destructive hover:text-destructive"
          >
            Clear PIN
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving || pin === ""}>
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-4 w-4" />
              )}
              Save PIN
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
