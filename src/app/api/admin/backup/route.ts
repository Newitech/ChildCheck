import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createBackup, listBackups, scheduledBackupIfDue } from "@/lib/backup";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/backup
 *   Lists every .cbak file in BACKUPS_DIR (newest first).
 *   Admin-only.
 *
 * POST /api/admin/backup
 *   "Backup now": creates an encrypted .cbak bundle (DB + photos + branding +
 *   config), writes it to BACKUPS_DIR, and returns the file as an HTTP
 *   download (Content-Type: application/octet-stream, Content-Disposition:
 *   attachment; filename=...).
 *
 *   Optional query param: ?scheduled=1 → run the scheduled-backup-if-due
 *   check instead of a forced "now" backup. Returns JSON (no download).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items = await listBackups();
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Optional scheduled mode.
  const url = new URL(req.url);
  const scheduled = url.searchParams.get("scheduled") === "1";
  if (scheduled) {
    const result = await scheduledBackupIfDue(user.id);
    return NextResponse.json({ ...result });
  }

  // Force "backup now".
  const result = await createBackup(undefined, user.id);

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Length": String(result.sizeBytes),
      "Cache-Control": "no-store",
      "X-ChildCheck-Filename": result.filename,
      "X-ChildCheck-Photo-Count": String(result.photoCount),
    },
  });
}
