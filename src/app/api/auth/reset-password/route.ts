import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    token: z.string().min(10).max(100),
    password: z.string().min(8, "Password must be at least 8 characters"),
    passwordConfirm: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Passwords do not match",
  });

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * POST /api/auth/reset-password — consume a reset token + set a new password.
 *
 * 1. Hash the provided token (SHA-256) and look up the PasswordResetToken row.
 * 2. Reject if not found, already used (usedAt set), or expired (expiresAt past).
 * 3. Set the User's passwordHash to the new password's hash.
 * 4. Mark the token as used (usedAt = now) so it can't be reused.
 * 5. Audit-log auth.reset_password.
 * 6. Return { ok: true }.
 *
 * Access: public (no session — the user is resetting because they forgot).
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
  const { token, password } = parsed.data;
  const tokenHash = hashToken(token);

  const resetToken = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!resetToken) {
    return NextResponse.json(
      { error: "invalid_token", message: "This reset link is not valid." },
      { status: 400 },
    );
  }
  if (resetToken.usedAt) {
    return NextResponse.json(
      { error: "token_used", message: "This reset link has already been used. Request a new one." },
      { status: 400 },
    );
  }
  if (resetToken.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "token_expired", message: "This reset link has expired. Request a new one." },
      { status: 400 },
    );
  }

  // Set the new password + mark the token as used (in a transaction).
  const newHash = await hashPassword(password);
  await db.$transaction([
    db.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: newHash },
    }),
    db.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await logAudit({
    actorUserId: resetToken.userId,
    action: "auth.reset_password",
    entity: "User",
    entityId: resetToken.userId,
  });

  return NextResponse.json({ ok: true });
}
