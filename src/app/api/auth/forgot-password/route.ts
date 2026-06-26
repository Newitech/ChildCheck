import { NextResponse } from "next/server";
import { z } from "zod";
import { webcrypto, createHash } from "node:crypto";

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
});

const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// In-memory rate limiter by IP (single-process). For multi-instance, use Redis.
const ipAttempts = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const arr = (ipAttempts.get(ip) ?? []).filter((t) => t > cutoff);
  arr.push(now);
  ipAttempts.set(ip, arr);
  return arr.length > RATE_LIMIT_MAX;
}

/** Generate a 32-byte URL-safe token. Returns the raw token (NOT hashed). */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  webcrypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** Synchronous SHA-256 hex via node:crypto — this is what we store. */
function hashTokenSync(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

/**
 * POST /api/auth/forgot-password — email-based password recovery.
 *
 * When `email_recovery` is ON + SMTP configured:
 *   1. Look up the User by Person.email.
 *   2. Generate a single-use, 30-min-TTL reset token (SHA-256 hashed in DB).
 *   3. Email a reset link to that address via sendEmail().
 *   4. Audit-log auth.forgot_password with the userId (NOT the email).
 *   5. ALWAYS return { ok: true } — even if no match — so this can't be used
 *      for user enumeration.
 *
 * Rate-limited: max 5 requests / hour / IP.
 *
 * Access: public (no session — the user forgot their password).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { email } = parsed.data;
  const ip = getIp(req);

  // Rate limit by IP (regardless of whether the email matches).
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: RATE_LIMIT_WINDOW_MS },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  const recoveryEnabled = await isFeatureEnabled("email_recovery");
  if (!recoveryEnabled) {
    return NextResponse.json(
      { error: "email_recovery_disabled" },
      { status: 403 },
    );
  }

  // Look up the user by Person.email — but ALWAYS return ok:true (even if no
  // match) so this endpoint can't be used for user enumeration.
  const person = await db.person.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, firstName: true, user: { select: { id: true } } },
  });
  const user = person?.user;

  if (!user) {
    await logAudit({
      actorUserId: null,
      action: "auth.forgot_password_unknown_email",
      entity: "User",
      details: { ip },
    });
    return NextResponse.json({
      ok: true,
      message:
        "If an account exists for that email, a reset link has been sent.",
    });
  }

  // Generate the token + store its SHA-256 hash.
  const rawToken = generateToken();
  const tokenHash = hashTokenSync(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  // Build the reset link. NEXTAUTH_URL is the app's public base URL.
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const resetLink = `${baseUrl}/reset-password?token=${rawToken}`;

  // Send the email. If SMTP isn't configured, log internally but still return
  // ok:true (don't leak SMTP-config state to the caller).
  const name = person?.firstName ?? "there";
  const result = await sendEmail({
    to: email,
    subject: "Reset your ChildCheck password",
    text:
      `Hi ${name},\n\n` +
      `We received a request to reset your ChildCheck password.\n\n` +
      `Click this link to set a new password (it expires in 30 minutes):\n` +
      `${resetLink}\n\n` +
      `If you didn't request this, you can safely ignore this email — your password is still unchanged.\n\n` +
      `— ChildCheck`,
    html:
      `<p>Hi ${name},</p>` +
      `<p>We received a request to reset your ChildCheck password.</p>` +
      `<p><a href="${resetLink}" style="display:inline-block;padding:10px 20px;background:#0f9d8a;color:#fff;text-decoration:none;border-radius:6px;">Reset my password</a></p>` +
      `<p style="color:#666;font-size:13px;">Or copy this link: ${resetLink}</p>` +
      `<p style="color:#666;font-size:13px;">This link expires in 30 minutes.</p>` +
      `<p>If you didn't request this, you can safely ignore this email — your password is still unchanged.</p>` +
      `<p>— ChildCheck</p>`,
  });

  if (!result.ok && result.error === "smtp_not_configured") {
    await logAudit({
      actorUserId: user.id,
      action: "auth.forgot_password_smtp_not_configured",
      entity: "User",
      entityId: user.id,
    });
    // Still return ok:true to avoid leaking SMTP-config state.
    return NextResponse.json({
      ok: true,
      message:
        "If an account exists for that email, a reset link has been sent.",
    });
  }

  await logAudit({
    actorUserId: user.id,
    action: "auth.forgot_password_requested",
    entity: "User",
    entityId: user.id,
  });

  return NextResponse.json({
    ok: true,
    message:
      "If an account exists for that email, a reset link has been sent.",
  });
}
