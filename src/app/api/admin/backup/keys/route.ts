import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/backup/keys
 *
 * Downloads the critical encryption/signing secrets as a .env file so the
 * admin can store them offline (safe deposit, password manager, etc.).
 *
 * These are the secrets REQUIRED to restore a backup:
 *   - CHILDCHECK_DATA_KEY  (AES-256-GCM master key — encrypts photos, backups, SMTP passwords)
 *   - NEXTAUTH_SECRET       (signs session JWTs + guardian session cookies)
 *   - REALTIME_INTERNAL_KEY (shared secret for the realtime mini-service)
 *
 * Admin-only. Audit-logged as `backup.keys_export`.
 * Never returns the values in JSON — always as a file download.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const keys = {
    CHILDCHECK_DATA_KEY: process.env.CHILDCHECK_DATA_KEY ?? "",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "",
    REALTIME_INTERNAL_KEY: process.env.REALTIME_INTERNAL_KEY ?? "",
  };

  // Check if any key is empty (dev fallback for DATA_KEY is silent — flag it).
  const warnings: string[] = [];
  if (!keys.CHILDCHECK_DATA_KEY) {
    warnings.push("CHILDCHECK_DATA_KEY is not set — the dev fallback key is in use. Photos and backups cannot be restored on a different machine without this key.");
  }
  if (!keys.NEXTAUTH_SECRET) {
    warnings.push("NEXTAUTH_SECRET is not set — sessions will not survive a restart or migration.");
  }

  // Build the .env file content.
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    "# ChildCheck encryption keys — exported " + new Date().toISOString(),
    "# Store this file securely (safe deposit, password manager, etc.).",
    "# Without CHILDCHECK_DATA_KEY, all encrypted photos and backups are UNRECOVERABLE.",
    "# Without NEXTAUTH_SECRET, all existing sessions are invalidated on restore.",
    "",
    ...warnings.map((w) => "# WARNING: " + w),
    "",
    `CHILDCHECK_DATA_KEY=${keys.CHILDCHECK_DATA_KEY}`,
    `NEXTAUTH_SECRET=${keys.NEXTAUTH_SECRET}`,
    `REALTIME_INTERNAL_KEY=${keys.REALTIME_INTERNAL_KEY}`,
    "",
  ];
  const content = lines.join("\n");

  await logAudit({
    actorUserId: user.id,
    action: "backup.keys_export",
    entity: "System",
    details: { warnings: warnings.length },
  });

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="childcheck-keys-${date}.env"`,
      "Cache-Control": "no-store",
    },
  });
}
