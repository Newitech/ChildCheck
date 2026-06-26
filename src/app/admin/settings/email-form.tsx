"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  Save,
  Send,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

type Security = "starttls" | "ssl" | "none";

interface SmtpConfigResponse {
  host: string;
  port: number;
  security: Security;
  username: string;
  hasPassword: boolean;
  fromAddress: string;
  fromName: string;
  lastTestStatus: string; // "untested" | "ok" | "fail:<message>"
  lastTestAt: string | null;
  isActive: boolean;
  updatedAt: string | null;
  envOverride: boolean;
}

/**
 * Email tab — SMTP server configuration.
 *
 * The admin enters their org's outbound mail server (host, port, security,
 * username, password, from-address, from-name) + an "active" toggle. The
 * password is encrypted at rest (AES-256-GCM) via src/lib/crypto.ts — see
 * the API route for the encryption + storage.
 *
 * "Use Gmail defaults" preset fills host=smtp.gmail.com, port=587,
 * security=starttls (the standard Gmail config — requires an App Password,
 * not the account password).
 *
 * "Send test email" runs `verify()` on the connection and (optionally) sends
 * a small test email to a recipient the admin specifies.
 *
 * Email features (password recovery, report emailing) are disabled until
 * SMTP is configured + Active. The relevant feature flags live in the
 * "Feature Toggles" tab.
 */
export function EmailForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);

  const [host, setHost] = useState("smtp.gmail.com");
  const [port, setPort] = useState("587");
  const [security, setSecurity] = useState<Security>("starttls");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromName, setFromName] = useState("ChildCheck");
  const [isActive, setIsActive] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [lastTestStatus, setLastTestStatus] = useState("untested");
  const [lastTestAt, setLastTestAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [envOverride, setEnvOverride] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/smtp", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as SmtpConfigResponse;
        if (cancelled) return;
        setHost(data.host || "smtp.gmail.com");
        setPort(String(data.port || 587));
        setSecurity(data.security || "starttls");
        setUsername(data.username || "");
        setHasPassword(data.hasPassword);
        setFromAddress(data.fromAddress || "");
        setFromName(data.fromName || "ChildCheck");
        setIsActive(data.isActive);
        setLastTestStatus(data.lastTestStatus || "untested");
        setLastTestAt(data.lastTestAt);
        setUpdatedAt(data.updatedAt);
        setEnvOverride(data.envOverride);
      } catch (e) {
        toast.error("Failed to load SMTP config", {
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePreset = (preset: "gmail" | "office365" | "outlook" | "yahoo" | "zoho") => {
    const presets: Record<string, { host: string; port: string; security: Security; label: string; note: string }> = {
      gmail: {
        host: "smtp.gmail.com",
        port: "587",
        security: "starttls",
        label: "Gmail / Google Workspace",
        note: "Requires an App Password (not your account password). Create one at myaccount.google.com/apppasswords — 2FA must be enabled on the Google account.",
      },
      office365: {
        host: "smtp.office365.com",
        port: "587",
        security: "starttls",
        label: "Microsoft 365 / Office 365",
        note: "Use your full email address + your Microsoft 365 password. SMTP AUTH must be enabled on the mailbox (organisations sometimes disable it by default — check the Exchange admin centre).",
      },
      outlook: {
        host: "smtp-mail.outlook.com",
        port: "587",
        security: "starttls",
        label: "Outlook.com (personal)",
        note: "Use your Outlook.com email + password (or an app password if 2FA is on).",
      },
      yahoo: {
        host: "smtp.mail.yahoo.com",
        port: "587",
        security: "starttls",
        label: "Yahoo Mail",
        note: "Requires an app password (not your account password). Create one at Yahoo Account Security.",
      },
      zoho: {
        host: "smtp.zoho.com",
        port: "587",
        security: "starttls",
        label: "Zoho Mail",
        note: "Use your Zoho email + password (or app-specific password if 2FA is on).",
      },
    };
    const p = presets[preset];
    if (!p) return;
    setHost(p.host);
    setPort(p.port);
    setSecurity(p.security);
    toast.info(`${p.label} preset applied — host, port, ${p.security}.`, {
      description: p.note,
    });
  };

  const handleSecurityChange = (v: string) => {
    const sec = v as Security;
    setSecurity(sec);
    // Auto-suggest the standard port for the chosen security mode (only if
    // the user hasn't customised the port). Standard ports: 587/465/25.
    if (sec === "ssl" && port === "587") setPort("465");
    else if (sec === "starttls" && (port === "465" || port === "25")) setPort("587");
    else if (sec === "none" && port === "587") setPort("25");
  };

  const handleSave = async () => {
    if (isActive && (!host.trim() || !username.trim() || !fromAddress.trim())) {
      toast.error("Active SMTP requires host, username, and from address.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/smtp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port, 10) || 587,
          security,
          username: username.trim(),
          // Send password ONLY if the admin typed a new one. Empty string
          // means "keep the existing one".
          password: password || "",
          fromAddress: fromAddress.trim(),
          fromName: fromName.trim(),
          isActive,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | { ok?: boolean; error?: string; config?: SmtpConfigResponse }
        | Record<string, never>;
      if (!res.ok || !data.ok) {
        toast.error((data as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      // Clear the password field after a successful save — the admin would
      // have to re-enter it intentionally to change it again.
      setPassword("");
      if (data.config) {
        setHasPassword(data.config.hasPassword);
        setLastTestStatus(data.config.lastTestStatus);
        setLastTestAt(data.config.lastTestAt);
        setUpdatedAt(data.config.updatedAt);
      }
      toast.success("SMTP settings saved");
    } catch (e) {
      toast.error("Failed to save SMTP settings", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (to: string) => {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/settings/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(to ? { to } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as
        | { ok?: boolean; message?: string; error?: string }
        | Record<string, never>;
      // 409 with smtp_not_configured → friendly "Configure SMTP first" toast.
      if (res.status === 409 || (data as { error?: string }).error === "smtp_not_configured") {
        toast.error("SMTP is not configured", {
          description: "Save a host + username + password and toggle Active first, then test.",
        });
        // Refresh last-test-status — the endpoint persisted fail:smtp_not_configured.
        try {
          const cfg = await fetch("/api/admin/settings/smtp", { cache: "no-store" });
          if (cfg.ok) {
            const c = (await cfg.json()) as SmtpConfigResponse;
            setLastTestStatus(c.lastTestStatus);
            setLastTestAt(c.lastTestAt);
          }
        } catch {
          // best-effort refresh
        }
        return;
      }
      // Check both HTTP status and the body's `ok` flag — the endpoint returns
      // 200 + { ok: false, message } for generic SMTP failures (e.g. wrong
      // credentials), and we want to surface those as errors, not successes.
      if (!res.ok || data.ok === false) {
        toast.error("SMTP test failed", {
          description: (data as { message?: string }).message
            ?? (data as { error?: string }).error
            ?? `HTTP ${res.status}`,
        });
        // Refresh last-test-status.
        try {
          const cfg = await fetch("/api/admin/settings/smtp", { cache: "no-store" });
          if (cfg.ok) {
            const c = (await cfg.json()) as SmtpConfigResponse;
            setLastTestStatus(c.lastTestStatus);
            setLastTestAt(c.lastTestAt);
          }
        } catch {
          // best-effort refresh
        }
        return;
      }
      toast.success("SMTP test succeeded", {
        description: (data as { message?: string }).message,
      });
      // Refresh last-test-status from the server.
      try {
        const cfg = await fetch("/api/admin/settings/smtp", { cache: "no-store" });
        if (cfg.ok) {
          const c = (await cfg.json()) as SmtpConfigResponse;
          setLastTestStatus(c.lastTestStatus);
          setLastTestAt(c.lastTestAt);
        }
      } catch {
        // best-effort refresh
      }
    } catch (e) {
      toast.error("SMTP test failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading SMTP settings…
      </div>
    );
  }

  const lastTestBadge = (() => {
    if (lastTestStatus === "untested")
      return (
        <Badge variant="outline" className="gap-1">
          <AlertCircle className="h-3 w-3" /> Untested
        </Badge>
      );
    if (lastTestStatus === "ok")
      return (
        <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> OK
        </Badge>
      );
    if (lastTestStatus.startsWith("fail:"))
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    return (
      <Badge variant="outline" className="gap-1">
        <AlertCircle className="h-3 w-3" /> Unknown
      </Badge>
    );
  })();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <CardTitle className="text-lg">SMTP server</CardTitle>
                <CardDescription>
                  Outbound mail server for sending password-reset links, report
                  emails, and notifications. The password is encrypted at rest
                  (AES-256-GCM).
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select onValueChange={(v) => handlePreset(v as "gmail" | "office365" | "outlook" | "yahoo" | "zoho")}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <SelectValue placeholder="Quick presets…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gmail">Gmail / Google Workspace</SelectItem>
                  <SelectItem value="office365">Microsoft 365 / Office 365</SelectItem>
                  <SelectItem value="outlook">Outlook.com (personal)</SelectItem>
                  <SelectItem value="yahoo">Yahoo Mail</SelectItem>
                  <SelectItem value="zoho">Zoho Mail</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            <strong className="text-foreground">Works with any SMTP server.</strong>{" "}
            Pick a preset above to auto-fill common settings, or enter your own.
            Other providers (Amazon SES, SendGrid, Mailgun, Postfix on localhost,
            Exchange, ProtonMail Bridge, etc.) work too — use the host/port/security
            your provider documents. The password is encrypted at rest (AES-256-GCM).
          </div>
          {envOverride && (
            <div className="rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  SMTP environment variables are set
                </p>
                <p className="text-amber-800 dark:text-amber-300 mt-0.5">
                  The values saved here are ignored when <code>SMTP_HOST</code> /
                  <code> SMTP_PORT</code> / <code>SMTP_USER</code> / <code>SMTP_PASS</code> /
                  <code> SMTP_FROM</code> are present in the environment. Remove those env vars
                  to use the database config below.
                </p>
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Host" hint="e.g. smtp.gmail.com">
              <Input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="smtp.gmail.com"
                maxLength={255}
              />
            </Field>
            <Field label="Port" hint="587 (StartTLS) · 465 (SSL) · 25 (none)">
              <Input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                min={1}
                max={65535}
              />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Security" hint="StartTLS recommended for Gmail (587)">
              <Select value={security} onValueChange={handleSecurityChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starttls">StartTLS (port 587)</SelectItem>
                  <SelectItem value="ssl">SSL (port 465)</SelectItem>
                  <SelectItem value="none">None (port 25, not recommended)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Username" hint="Usually your full email address">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="you@gmail.com"
                maxLength={255}
                autoComplete="off"
              />
            </Field>
          </div>

          <Field
            label="Password"
            hint={
              hasPassword
                ? "•••••••• (stored encrypted — leave blank to keep the existing password)"
                : "App Password for Gmail (NOT your account password)"
            }
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? "•••••••• — leave blank to keep existing" : "App Password"}
              autoComplete="new-password"
              maxLength={1024}
            />
          </Field>

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm flex items-start gap-2">
            <ExternalLink className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">
                Gmail requires an App Password, not your account password
              </p>
              <p className="text-muted-foreground mt-0.5">
                Enable 2-Step Verification, then create an App Password at{" "}
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  myaccount.google.com/apppasswords
                </a>
                . Paste the 16-character password into the field above.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="From address" hint="Where outbound mail appears to come from">
              <Input
                type="email"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                placeholder="you@gmail.com"
                maxLength={320}
                autoComplete="off"
              />
            </Field>
            <Field label="From name" hint="Display name shown in recipients' inboxes">
              <Input
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Riverside SDA Church"
                maxLength={120}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
            <div>
              <Label htmlFor="smtp-active" className="text-sm font-medium">
                Active
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Email features only send mail when SMTP is configured + Active.
              </p>
            </div>
            <Switch id="smtp-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Last test:</span>
            {lastTestBadge}
            {lastTestAt && (
              <span className="text-xs text-muted-foreground">
                {new Date(lastTestAt).toLocaleString()}
              </span>
            )}
            {updatedAt && (
              <span className="text-xs text-muted-foreground ml-auto">
                Config saved {new Date(updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Test the SMTP connection</CardTitle>
          <CardDescription>
            Verifies the handshake (EHLO, STARTTLS, AUTH). Optionally sends a
            small test email to a recipient you specify.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTestDialogOpen(true)}
              disabled={testing || saving}
            >
              {testing ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-4 w-4" />
              )}
              Send test email
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
          <TestEmailDialog
            open={testDialogOpen}
            onOpenChange={setTestDialogOpen}
            testing={testing}
            onTest={(to) => void handleTest(to)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">About email features</CardTitle>
          <CardDescription>
            Which features use SMTP, and how they degrade when it&apos;s off.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Email features (password recovery, report emailing) are disabled
            until SMTP is configured + Active. Toggle the{" "}
            <code className="bg-muted px-1 py-0.5 rounded">email_recovery</code> /{" "}
            <code className="bg-muted px-1 py-0.5 rounded">email_as_contact</code> flags
            in the Feature Toggles tab to control which features use email.
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
            <li>
              <strong className="text-foreground">Report emailing</strong> — the
              &ldquo;Email&rdquo; button on the Reports page sends a CSV copy to a
              recipient. If SMTP is off, the request fails with a clear{" "}
              <code className="bg-muted px-1 py-0.5 rounded">smtp_not_configured</code>{" "}
              error and the UI shows a &ldquo;Configure SMTP in Settings → Email first&rdquo;
              message.
            </li>
            <li>
              <strong className="text-foreground">Password recovery</strong> — gated
              behind the <code className="bg-muted px-1 py-0.5 rounded">email_recovery</code>{" "}
              flag (default OFF). When ON + SMTP configured, a future{" "}
              <code className="bg-muted px-1 py-0.5 rounded">/api/auth/forgot-password</code>{" "}
              route will email a reset link.
            </li>
            <li>
              <strong className="text-foreground">Email as contact method</strong> — the{" "}
              <code className="bg-muted px-1 py-0.5 rounded">email_as_contact</code>{" "}
              flag (default ON) controls whether email is stored as a contact field on
              Person records. Independent of SMTP sending.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Sticky save bar — inherited from the /admin layout footer pattern. */}
      <div className="flex items-center justify-end gap-2 sticky bottom-0 bg-background/85 backdrop-blur py-3 -mx-4 px-4 border-t sm:rounded">
        <Button
          type="button"
          variant="outline"
          onClick={() => setTestDialogOpen(true)}
          disabled={testing || saving}
        >
          {testing ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-4 w-4" />
          )}
          Send test email
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          Save changes
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test email dialog
// ---------------------------------------------------------------------------

function TestEmailDialog({
  open,
  onOpenChange,
  testing,
  onTest,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  testing: boolean;
  onTest: (to: string) => void;
}) {
  // Render the dialog with `key={open ? "open" : "closed"}` so the inner
  // input state is reset to "" every time the dialog closes (and re-mounts
  // fresh when re-opened). Avoids a setState-in-effect.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent key={open ? "open" : "closed"}>
        <TestEmailDialogBody testing={testing} onTest={onTest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TestEmailDialogBody({
  testing,
  onTest,
  onClose,
}: {
  testing: boolean;
  onTest: (to: string) => void;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Send test email</DialogTitle>
        <DialogDescription>
          Verifies the SMTP connection + sends a small test email. Leave the
          recipient blank to just verify the connection (no message sent).
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <Field label="Recipient (optional)" hint="Leave blank to just verify the connection">
          <Input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            autoComplete="off"
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={testing}>
          Cancel
        </Button>
        <Button
          onClick={() => onTest(to.trim())}
          disabled={testing}
        >
          {testing ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-4 w-4" />
          )}
          Send test
        </Button>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
