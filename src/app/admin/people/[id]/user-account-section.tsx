"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

import { ROLE_PERMISSIONS } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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

const KNOWN_ROLES = Object.keys(ROLE_PERMISSIONS);

/**
 * Compact summary of a User linked to this Person. Null if no User exists.
 *
 * Field shape mirrors what /api/admin/users returns (single GET).
 */
export interface UserSummary {
  id: string;
  username: string;
  status: string;
  lastLoginAt: string | null;
  hasPin: boolean;
  roles: string[];
}

interface Props {
  personId: string;
  firstName: string;
  lastName: string;
  initial: UserSummary | null;
}

/**
 * Person-detail "User account" section.
 *
 * - If the Person has no User: shows a "Promote to user" button → dialog
 *   (username default firstName.lastName, password, optional PIN, role
 *   checkboxes default Volunteer).
 * - If the Person has a User: shows their username, role badges, status,
 *   last login, "Has login" badge + a link "Manage in Users →" to
 *   /admin/users.
 *
 * Only rendered for Adult persons (children can't have login accounts).
 */
export function PersonUserAccountSection({
  personId,
  firstName,
  lastName,
  initial,
}: Props) {
  const router = useRouter();
  const [user, setUser] = useState<UserSummary | null>(initial);
  const [open, setOpen] = useState(false);

  // Default username derived from firstName.lastName, sanitised + lowercased.
  const defaultUsername = useMemo(() => {
    const sanitize = (s: string) =>
      s
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9._-]/g, "")
        .slice(0, 60);
    const f = sanitize(firstName);
    const l = sanitize(lastName);
    return [f, l].filter(Boolean).join(".") || "user";
  }, [firstName, lastName]);

  // Refresh the user summary from the API (best-effort).
  const refresh = async () => {
    try {
      // Use the people GET endpoint — `hasUser` flag tells us if a user is
      // linked. If linked, we then look it up via the users list.
      const [personRes, usersRes] = await Promise.all([
        fetch(`/api/admin/people/${personId}`, { cache: "no-store" }),
        fetch(`/api/admin/users`, { cache: "no-store" }),
      ]);
      if (!personRes.ok || !usersRes.ok) return;
      const person = (await personRes.json()) as { hasUser: boolean };
      if (!person.hasUser) {
        setUser(null);
        return;
      }
      const usersData = (await usersRes.json()) as {
        items: UserSummary[];
      };
      const found = usersData.items.find((u) => {
        // The users API doesn't return personId directly per item in the
        // section's `UserSummary` shape — but it DOES return personId. We
        // accept the wider shape here.
        return (u as UserSummary & { personId?: string }).personId === personId;
      });
      if (found) setUser(found);
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    setUser(initial);
  }, [initial]);

  const onCreated = () => {
    setOpen(false);
    toast.success("User account created");
    void refresh();
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Login account
        </CardTitle>
        <CardDescription>
          A login account lets this person sign in to ChildCheck with a
          username + password (and optional PIN for the kiosk).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {user ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="gap-1">
                    <Check className="h-3 w-3" /> Has login
                  </Badge>
                  <Badge
                    variant={
                      user.status === "Active" ? "default" : "destructive"
                    }
                    className={
                      user.status === "Active"
                        ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                        : ""
                    }
                  >
                    {user.status}
                  </Badge>
                  {user.hasPin && (
                    <Badge variant="outline" className="gap-1">
                      <KeyRound className="h-3 w-3" /> PIN
                    </Badge>
                  )}
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">Username:</span>{" "}
                  <code className="font-mono">{user.username}</code>
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Last login:</span>{" "}
                  {user.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleString()
                    : "Never"}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-xs text-muted-foreground">Roles:</span>
                  {user.roles.length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">
                      none
                    </span>
                  ) : (
                    user.roles
                      .slice()
                      .sort((a, b) => a.localeCompare(b))
                      .map((r) => (
                        <Badge
                          key={r}
                          variant={r === "Admin" ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {r}
                        </Badge>
                      ))
                  )}
                </div>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/users">
                Manage in Users <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This person has no login account. Promote them to create one.
            </p>
            <Button onClick={() => setOpen(true)} size="sm">
              <UserPlus className="mr-1.5 h-4 w-4" /> Promote to user
            </Button>
          </div>
        )}
      </CardContent>

      <PromoteToUserDialog
        open={open}
        onOpenChange={setOpen}
        personId={personId}
        defaultUsername={defaultUsername}
        firstName={firstName}
        lastName={lastName}
        onCreated={onCreated}
      />
    </Card>
  );
}

// =========================================================================
// Promote-to-user dialog
// =========================================================================

interface PromoteProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  personId: string;
  defaultUsername: string;
  firstName: string;
  lastName: string;
  onCreated: () => void;
}

function PromoteToUserDialog({
  open,
  onOpenChange,
  personId,
  defaultUsername,
  firstName,
  lastName,
  onCreated,
}: PromoteProps) {
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pin, setPin] = useState("");
  const [roles, setRoles] = useState<string[]>(["Volunteer"]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setUsername(defaultUsername);
      setPassword("");
      setConfirm("");
      setPin("");
      setRoles(["Volunteer"]);
    }
  }, [open, defaultUsername]);

  const toggleRole = (role: string) => {
    setRoles((cur) =>
      cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role],
    );
  };

  const submit = async () => {
    if (username.trim().length < 3) {
      toast.error("Username must be at least 3 characters.");
      return;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(username.trim())) {
      toast.error(
        "Username may only contain letters, numbers, '.', '_' and '-'.",
      );
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    if (pin !== "" && !/^\d{4,6}$/.test(pin)) {
      toast.error("PIN must be 4–6 digits.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId,
          username: username.trim(),
          password,
          pin: pin === "" ? null : pin,
          roles,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      onCreated();
    } catch (e) {
      toast.error("Failed to create user", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Promote to user
          </DialogTitle>
          <DialogDescription>
            Create a login account for{" "}
            <strong>
              {firstName} {lastName}
            </strong>
            . They will be able to sign in with the username + password below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Username */}
          <div className="space-y-1.5">
            <Label htmlFor="pu-username" className="text-sm">
              Username <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pu-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={64}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              3–64 chars · letters, numbers, <code>.</code>, <code>_</code>,{" "}
              <code>-</code>. Default derived from name.
            </p>
          </div>

          {/* Password + confirm */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pu-pwd" className="text-sm">
                Password <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pu-pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                maxLength={128}
              />
              <p className="text-xs text-muted-foreground">Min 8 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pu-confirm" className="text-sm">
                Confirm <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pu-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                maxLength={128}
              />
            </div>
          </div>

          {/* Optional PIN */}
          <div className="space-y-1.5">
            <Label htmlFor="pu-pin" className="text-sm flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> PIN (optional)
            </Label>
            <Input
              id="pu-pin"
              inputMode="numeric"
              pattern="\d*"
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="4–6 digits"
              autoComplete="off"
              maxLength={6}
            />
            <p className="text-xs text-muted-foreground">
              Lets the user sign in at the kiosk with a quick PIN.
            </p>
          </div>

          {/* Roles */}
          <div className="space-y-2">
            <Label className="text-sm">Roles</Label>
            <p className="text-xs text-muted-foreground">
              Pick the roles this account should have. Default: Volunteer.
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {KNOWN_ROLES.map((role) => {
                const checked = roles.includes(role);
                return (
                  <label
                    key={role}
                    htmlFor={`pu-role-${role}`}
                    className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <Checkbox
                      id={`pu-role-${role}`}
                      checked={checked}
                      onCheckedChange={() => toggleRole(role)}
                    />
                    <span className="text-sm font-medium">{role}</span>
                  </label>
                );
              })}
            </div>
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
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-1.5 h-4 w-4" />
            )}
            Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
