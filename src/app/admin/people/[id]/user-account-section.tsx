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
import {
  ALL_STAFF_ROLES,
  LOGIN_REQUIRED_ROLES,
} from "@/lib/person-roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
 * Compact summary of a User login linked to this Person. Null if no login.
 *
 * LOGIN-ONLY: roles + PIN moved to Person (PersonRole + Person.pinHash). This
 * shape mirrors what /api/admin/users returns.
 */
export interface UserSummary {
  id: string;
  username: string;
  status: string;
  lastLoginAt: string | null;
}

interface Props {
  personId: string;
  firstName: string;
  lastName: string;
  initial: UserSummary | null;
  /** Whether the Person has a guardian PIN set (Person.pinHash). */
  initialHasPin: boolean;
  /** Staff roles assigned to the Person (PersonRole). */
  initialRoles: string[];
}

/**
 * Person-detail "Permissions & Access" card.
 *
 * Three parts:
 * 1. Roles — checkboxes for each staff role (Admin/PM require a login).
 * 2. Guardian PIN — set/clear the Person's guardian/kiosk PIN.
 * 3. Login account — optional staff sign-in (promote / status / last login).
 *
 * Only rendered for Adult persons.
 */
export function PersonUserAccountSection({
  personId,
  firstName,
  lastName,
  initial,
  initialHasPin,
  initialRoles,
}: Props) {
  const router = useRouter();
  const [user, setUser] = useState<UserSummary | null>(initial);
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<string[]>(initialRoles);
  const [hasPin, setHasPin] = useState(initialHasPin);

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

  useEffect(() => {
    setUser(initial);
  }, [initial]);

  const hasUser = !!user;

  const onCreated = () => {
    setOpen(false);
    toast.success("Login account created");
    router.refresh();
  };

  // ---- Roles ----
  const toggleRole = async (role: string) => {
    const next = roles.includes(role)
      ? roles.filter((r) => r !== role)
      : [...roles, role];
    // Optimistic.
    const prev = roles;
    setRoles(next);
    try {
      const res = await fetch(`/api/admin/people/${personId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as { roles: string[] };
      setRoles(data.roles);
      toast.success("Roles updated");
    } catch (e) {
      setRoles(prev); // revert
      toast.error("Could not update roles", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  // ---- Guardian PIN ----
  const onPinSaved = (nowHasPin: boolean) => {
    setHasPin(nowHasPin);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Permissions &amp; Access
        </CardTitle>
        <CardDescription>
          Staff roles, guardian PIN, and optional login for this person.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ---- Roles ---- */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-semibold">Staff roles</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Grant permission roles. Admin &amp; PeopleManager require a login
            account.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {(ALL_STAFF_ROLES as readonly string[]).map((role) => {
              const checked = roles.includes(role);
              const locked =
                LOGIN_REQUIRED_ROLES.has(role) && !hasUser;
              return (
                <label
                  key={role}
                  className={`flex items-center gap-2 rounded-md border p-2 ${
                    locked
                      ? "opacity-60 cursor-not-allowed"
                      : "cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={checked}
                    onChange={() => void toggleRole(role)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm font-medium">{role}</span>
                  {locked && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      needs login
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* ---- Guardian PIN ---- */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-semibold flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> Guardian PIN
            </Label>
            {hasPin ? (
              <Badge variant="outline" className="gap-1">
                <Check className="h-3 w-3" /> PIN set
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                No PIN
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            The 4–6 digit PIN used at the kiosk and guardian portal. Works with
            or without a login.
          </p>
          <SetPinDialog
            personId={personId}
            firstName={firstName}
            lastName={lastName}
            hasPin={hasPin}
            onSaved={onPinSaved}
          />
        </div>

        {/* ---- Login account ---- */}
        <div className="space-y-2 border-t pt-4">
          <Label className="text-sm font-semibold">Login account (optional)</Label>
          {user ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="gap-1">
                  <Check className="h-3 w-3" /> Has login
                </Badge>
                <Badge
                  variant={user.status === "Active" ? "default" : "destructive"}
                  className={
                    user.status === "Active"
                      ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                      : ""
                  }
                >
                  {user.status}
                </Badge>
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
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/users">
                  Manage in Users <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                No staff login. Create one to let this person sign in to the
                admin/volunteer app.
              </p>
              <Button onClick={() => setOpen(true)} size="sm">
                <UserPlus className="mr-1.5 h-4 w-4" /> Create login
              </Button>
            </div>
          )}
        </div>
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
// Set / clear PIN dialog
// =========================================================================

function SetPinDialog({
  personId,
  firstName,
  lastName,
  hasPin,
  onSaved,
}: {
  personId: string;
  firstName: string;
  lastName: string;
  hasPin: boolean;
  onSaved: (nowHasPin: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setPin("");
  }, [open]);

  const submit = async (overridePin?: string) => {
    const value = overridePin ?? pin;
    if (value !== "" && !/^\d{4,6}$/.test(value)) {
      toast.error("PIN must be 4–6 digits.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/people/${personId}/pin`, {
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
            ? `PIN removed for ${firstName} ${lastName}.`
            : `PIN set for ${firstName} ${lastName}.`,
      });
      onSaved(value !== "");
      setOpen(false);
    } catch (e) {
      toast.error("Failed to set PIN", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Lock className="mr-1.5 h-4 w-4" />
        {hasPin ? "Set / change PIN" : "Set PIN"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              Guardian PIN — {firstName} {lastName}
            </DialogTitle>
            <DialogDescription>
              A 4–6 digit PIN for the kiosk and guardian portal. Leave blank +
              Clear to remove an existing PIN.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="person-pin-input" className="text-sm">
                PIN (4–6 digits)
              </Label>
              <Input
                id="person-pin-input"
                type="password"
                inputMode="numeric"
                pattern="\d*"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="e.g. 1234"
                autoComplete="off"
                maxLength={6}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Current status:{" "}
                {hasPin ? (
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
              disabled={saving || !hasPin}
              className="sm:mr-auto text-destructive hover:text-destructive"
            >
              Clear PIN
            </Button>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={saving || pin === ""}
              >
                {saving ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                Set PIN
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// =========================================================================
// Promote-to-user (create login) dialog — login only (no PIN/roles fields)
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setUsername(defaultUsername);
      setPassword("");
      setConfirm("");
    }
  }, [open, defaultUsername]);

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

    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId,
          username: username.trim(),
          password,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      onCreated();
    } catch (e) {
      toast.error("Failed to create login", {
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
            Create login
          </DialogTitle>
          <DialogDescription>
            Create a staff login account for{" "}
            <strong>
              {firstName} {lastName}
            </strong>
            . They can then sign in with this username + password. Roles &amp;
            PIN are managed above.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
            Create login
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
