import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { encryptPassword, type SmtpSecurity } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * SMTP admin API — GET / PUT.
 *
 * GET  returns the current SMTP config WITHOUT the password — instead it
 *      surfaces a `hasPassword: boolean` so the admin UI can show "••••••••
 *      (leave blank to keep existing)" without ever leaking the secret.
 *
 * PUT  upserts the config. If `password` is provided (non-empty), it is
 *      AES-256-GCM encrypted before storage. If `password` is empty/omitted,
 *      the existing `passwordEnc` is preserved (so the admin can edit other
 *      fields without re-entering the password).
 *
 * Access: Admin only.
 */

const SECURITY_VALUES = ["starttls", "ssl", "none"] as const;

const putSchema = z.object({
  host: z.string().trim().max(255).default(""),
  port: z.number().int().min(1).max(65535).default(587),
  security: z.enum(SECURITY_VALUES).default("starttls"),
  username: z.string().trim().max(255).default(""),
  password: z.string().max(1024).optional().default(""),
  fromAddress: z.string().trim().max(320).default(""),
  fromName: z.string().trim().max(120).default("ChildCheck"),
  isActive: z.boolean().default(false),
});

/** GET /api/admin/settings/smtp — current config (sans password). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const row = await db.smtpConfig.findUnique({ where: { id: "default" } });

  // If no row exists, return the defaults so the form has something to render.
  if (!row) {
    return NextResponse.json({
      host: "",
      port: 587,
      security: "starttls" as SmtpSecurity,
      username: "",
      hasPassword: false,
      fromAddress: "",
      fromName: "ChildCheck",
      lastTestStatus: "untested",
      lastTestAt: null,
      isActive: false,
      updatedAt: null,
      envOverride: !!process.env.SMTP_HOST,
    });
  }

  return NextResponse.json({
    host: row.host,
    port: row.port,
    security: row.security as SmtpSecurity,
    username: row.username,
    hasPassword: !!row.passwordEnc,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    lastTestStatus: row.lastTestStatus,
    lastTestAt: row.lastTestAt,
    isActive: row.isActive,
    updatedAt: row.updatedAt,
    envOverride: !!process.env.SMTP_HOST,
  });
}

/** PUT /api/admin/settings/smtp — upsert config. */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  // Read existing row (we need its passwordEnc when the admin submits an
  // empty password — i.e. they're editing other fields without re-entering
  // the password).
  const existing = await db.smtpConfig.findUnique({ where: { id: "default" } });

  let passwordEnc = existing?.passwordEnc ?? "";
  if (p.password && p.password.trim()) {
    passwordEnc = encryptPassword(p.password);
  }
  // If password is empty AND there was no existing password, passwordEnc
  // stays "" (the admin hasn't entered one yet — that's fine; they'll get a
  // clear "SMTP not configured" until they do).

  const saved = await db.smtpConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      host: p.host,
      port: p.port,
      security: p.security,
      username: p.username,
      passwordEnc,
      fromAddress: p.fromAddress,
      fromName: p.fromName,
      isActive: p.isActive,
      // Reset test status when config changes — the previous test no longer
      // reflects the current settings.
      lastTestStatus: "untested",
      lastTestAt: null,
    },
    update: {
      host: p.host,
      port: p.port,
      security: p.security,
      username: p.username,
      passwordEnc,
      fromAddress: p.fromAddress,
      fromName: p.fromName,
      isActive: p.isActive,
      lastTestStatus: "untested",
      lastTestAt: null,
    },
  });

  await logAudit({
    actorUserId: user.id,
    action: "smtp.update",
    entity: "SmtpConfig",
    entityId: "default",
    details: {
      host: saved.host,
      port: saved.port,
      security: saved.security,
      username: saved.username,
      fromAddress: saved.fromAddress,
      fromName: saved.fromName,
      isActive: saved.isActive,
      passwordChanged: !!(p.password && p.password.trim()),
    },
  });

  return NextResponse.json({
    ok: true,
    config: {
      host: saved.host,
      port: saved.port,
      security: saved.security,
      username: saved.username,
      hasPassword: !!saved.passwordEnc,
      fromAddress: saved.fromAddress,
      fromName: saved.fromName,
      lastTestStatus: saved.lastTestStatus,
      lastTestAt: saved.lastTestAt,
      isActive: saved.isActive,
      updatedAt: saved.updatedAt,
      envOverride: !!process.env.SMTP_HOST,
    },
  });
}
