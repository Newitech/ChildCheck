import nodemailer from "nodemailer";

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * Task EM — Outbound email (SMTP).
 *
 * Uses nodemailer with a configurable SMTP server. The config (host, port,
 * security mode, username, from-address) is stored in the SmtpConfig table;
 * the password is stored AES-256-GCM encrypted at rest (reusing the same
 * crypto.ts primitives as photos + backups). The encryption key is
 * CHILDCHECK_DATA_KEY.
 *
 * Env-var fallback: if SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS /
 * SMTP_FROM are set, they override the DB row. This lets a deploy ship SMTP
 * via env without ever touching the admin UI (immutable deploy-time config).
 *
 * All email features gracefully degrade when SMTP is not configured: callers
 * of `sendEmail()` get `{ ok: false, error: "smtp_not_configured" }` and can
 * surface that to the user (e.g. the Reports Email button shows "Configure
 * SMTP in Settings → Email first").
 *
 * nodemailer is a server-only library — this module is server-only.
 */

export type SmtpSecurity = "starttls" | "ssl" | "none";

export interface EmailAttachment {
  filename: string;
  content: string; // text content (e.g. CSV)
  contentType?: string;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export interface SmtpSettings {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  /** Decrypted plaintext password. */
  password: string;
  fromAddress: string;
  fromName: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface TestSmtpResult {
  ok: boolean;
  message: string;
  /**
   * Machine-readable error code. Currently only `"smtp_not_configured"`
   * (when getSmtpSettings() returns null). Other failures surface a
   * human-readable `message` but no code — callers treat them as generic
   * SMTP errors.
   */
  error?: "smtp_not_configured";
}

// ---------------------------------------------------------------------------
// Encrypted-password helpers (base64(iv || tag || ciphertext))
// ---------------------------------------------------------------------------

/**
 * Encrypt a UTF-8 string into a single base64 blob suitable for storage in
 * the SmtpConfig.passwordEnc column. Reuses the AES-256-GCM encrypt() from
 * crypto.ts so the same key + format protects both photos and SMTP passwords.
 */
export function encryptPassword(plaintext: string): string {
  if (!plaintext) return "";
  const buf = Buffer.from(plaintext, "utf-8");
  const { iv, tag, ciphertext } = encrypt(buf);
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/**
 * Decrypt a base64 blob produced by encryptPassword() back to the plaintext
 * UTF-8 password. Throws if the auth tag doesn't verify (tampered or wrong
 * key) — callers should catch and treat as "SMTP misconfigured".
 */
export function decryptPassword(blob: string): string {
  if (!blob) return "";
  const raw = Buffer.from(blob, "base64");
  // crypto.ts uses 12-byte IV + 16-byte tag.
  const IV_LEN = 12;
  const TAG_LEN = 16;
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error(
      `decryptPassword: blob too short (${raw.length} bytes, need ≥${IV_LEN + TAG_LEN})`,
    );
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  return decrypt(iv, tag, ciphertext).toString("utf-8");
}

// ---------------------------------------------------------------------------
// Env-var fallback
// ---------------------------------------------------------------------------

interface EnvSmtp {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

/**
 * Read SMTP config from environment variables. Returns null if SMTP_HOST is
 * unset (or empty). When env vars are present they WIN over the DB row —
 * this lets ops ship a deploy with SMTP baked in via env and never expose
 * the password to the admin UI.
 *
 *   SMTP_HOST     e.g. smtp.gmail.com
 *   SMTP_PORT     e.g. 587 (default if unset)
 *   SMTP_USER     e.g. you@gmail.com
 *   SMTP_PASS     the SMTP password (e.g. a Gmail App Password)
 *   SMTP_FROM     e.g. "ChildCheck <you@gmail.com>" or "you@gmail.com"
 *   SMTP_SECURITY "starttls" | "ssl" | "none" (default derived from port)
 */
function readEnvSmtp(): EnvSmtp | null {
  const host = (process.env.SMTP_HOST ?? "").trim();
  if (!host) return null;
  const portRaw = (process.env.SMTP_PORT ?? "").trim();
  const port = portRaw ? parseInt(portRaw, 10) : 587;
  const user = (process.env.SMTP_USER ?? "").trim();
  const pass = process.env.SMTP_PASS ?? "";
  const fromRaw = (process.env.SMTP_FROM ?? "").trim();
  const secRaw = (process.env.SMTP_SECURITY ?? "").trim().toLowerCase() as SmtpSecurity;

  let security: SmtpSecurity;
  if (secRaw === "starttls" || secRaw === "ssl" || secRaw === "none") {
    security = secRaw;
  } else {
    // Derive from port if unspecified.
    security = port === 465 ? "ssl" : port === 25 ? "none" : "starttls";
  }

  // Allow SMTP_FROM to be either "Name <addr>" or just "addr".
  let fromAddress = fromRaw;
  let fromName = "ChildCheck";
  const match = fromRaw.match(/^([^<]*?)\s*<([^>]+)>$/);
  if (match) {
    const n = match[1].trim().replace(/^["']|["']$/g, "");
    if (n) fromName = n;
    fromAddress = match[2].trim();
  }

  return { host, port, security, username: user, password: pass, fromAddress, fromName };
}

// ---------------------------------------------------------------------------
// Transport construction
// ---------------------------------------------------------------------------

function buildTransporter(s: SmtpSettings): nodemailer.Transporter {
  const secure = s.security === "ssl"; // nodemailer "secure" = implicit TLS (port 465)
  const requireTls = s.security === "starttls"; // opportunistic STARTTLS upgrade (port 587)

  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure,
    requireTls: requireTls || undefined,
    auth:
      s.username || s.password
        ? { user: s.username, pass: s.password }
        : undefined,
    // Reasonable defaults for a self-hosted church/school server.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  } as nodemailer.TransportOptions);
}

function formatFrom(s: SmtpSettings): string {
  if (!s.fromName) return s.fromAddress;
  // Quote the display name if it contains characters that need quoting.
  const needsQuote = /[<>()[\],;:@"\\]/.test(s.fromName);
  const name = needsQuote ? `"${s.fromName.replace(/"/g, '\\"')}"` : s.fromName;
  return `${name} <${s.fromAddress}>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load + decrypt the SMTP config. Returns null if SMTP is not configured
 * (no DB row + no env vars), or if isActive is false in the DB row.
 *
 * Env vars (if present) take precedence over the DB row.
 */
export async function getSmtpSettings(): Promise<SmtpSettings | null> {
  // Env-var path (highest precedence).
  const env = readEnvSmtp();
  if (env) {
    return {
      host: env.host,
      port: env.port,
      security: env.security,
      username: env.username,
      password: env.password,
      fromAddress: env.fromAddress,
      fromName: env.fromName,
    };
  }

  // DB path.
  const row = await db.smtpConfig.findUnique({ where: { id: "default" } });
  if (!row || !row.isActive) return null;
  if (!row.host.trim() || !row.username.trim()) return null;

  let password = "";
  if (row.passwordEnc) {
    try {
      password = decryptPassword(row.passwordEnc);
    } catch (err) {
      // Decryption failed (tampered blob or key rotation mismatch). Log and
      // treat as "not configured" — callers will surface a clear error.
      console.error("[email] failed to decrypt SMTP password:", err);
      return null;
    }
  }

  return {
    host: row.host,
    port: row.port,
    security: (row.security as SmtpSecurity) ?? "starttls",
    username: row.username,
    password,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
  };
}

/**
 * Test the SMTP connection. Calls `transporter.verify()`, which opens a
 * connection, performs the EHLO/STARTTLS/AUTH handshake, and closes without
 * sending any mail. Updates `lastTestStatus` + `lastTestAt` on the DB row.
 *
 * Optionally sends a tiny test email to `to` if provided (more thorough than
 * just verify() — confirms the from-address is accepted + the mailbox
 * receives).
 */
export async function testSmtpConnection(opts?: {
  to?: string;
}): Promise<TestSmtpResult> {
  const settings = await getSmtpSettings();
  if (!settings) {
    await updateLastTest("fail:smtp_not_configured");
    return {
      ok: false,
      message: "SMTP is not configured or not active.",
      error: "smtp_not_configured",
    };
  }

  const transporter = buildTransporter(settings);
  try {
    await transporter.verify();

    if (opts?.to) {
      const info = await transporter.sendMail({
        from: formatFrom(settings),
        to: opts.to,
        subject: "ChildCheck test email",
        text: "This is a test email from ChildCheck. If you received this, SMTP is working correctly.",
        html:
          "<p>This is a test email from <strong>ChildCheck</strong>.</p>" +
          "<p>If you received this, your SMTP configuration is working correctly.</p>",
      });
      await updateLastTest("ok");
      return {
        ok: true,
        message: `Verified + sent test email to ${opts.to} (messageId ${info.messageId}).`,
      };
    }

    await updateLastTest("ok");
    return {
      ok: true,
      message: "SMTP connection verified (handshake succeeded).",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Truncate the stored message — some SMTP servers return very long
    // multi-line errors that would bloat the row.
    const safe = message.slice(0, 200);
    await updateLastTest(`fail:${safe}`);
    return { ok: false, message };
  } finally {
    transporter.close();
  }
}

/**
 * Send an email. Returns `{ ok: true, messageId }` on success or
 * `{ ok: false, error }` on failure. Errors are audited (email.send_failed)
 * — successful sends are audited as `email.send` with { to, subject } only
 * (NEVER the body, for privacy).
 *
 * If SMTP is not configured, returns `{ ok: false, error: "smtp_not_configured" }`
 * — callers should surface a "Configure SMTP" message rather than crash.
 *
 * @param actorUserId optional user id for audit attribution
 */
export async function sendEmail(
  input: SendEmailInput,
  opts?: { actorUserId?: string },
): Promise<SendEmailResult> {
  const settings = await getSmtpSettings();
  if (!settings) {
    return { ok: false, error: "smtp_not_configured" };
  }

  const transporter = buildTransporter(settings);
  try {
    const info = await transporter.sendMail({
      from: formatFrom(settings),
      to: Array.isArray(input.to) ? input.to.join(", ") : input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType ?? "application/octet-stream",
      })),
    });

    // Best-effort audit — never block on it.
    await logAudit({
      actorUserId: opts?.actorUserId ?? null,
      action: "email.send",
      entity: "Email",
      entityId: info.messageId || null,
      details: {
        to: input.to,
        subject: input.subject,
        from: settings.fromAddress,
      },
    });

    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAudit({
      actorUserId: opts?.actorUserId ?? null,
      action: "email.send_failed",
      entity: "Email",
      details: {
        to: input.to,
        subject: input.subject,
        error: message.slice(0, 300),
      },
    });
    return { ok: false, error: message };
  } finally {
    transporter.close();
  }
}

// ---------------------------------------------------------------------------
// Internal: last-test-status persistence
// ---------------------------------------------------------------------------

async function updateLastTest(status: string): Promise<void> {
  try {
    await db.smtpConfig.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        lastTestStatus: status,
        lastTestAt: new Date(),
      },
      update: {
        lastTestStatus: status,
        lastTestAt: new Date(),
      },
    });
  } catch (err) {
    // Best-effort — don't crash a test on audit failure.
    console.error("[email] failed to persist lastTestStatus:", err);
  }
}
