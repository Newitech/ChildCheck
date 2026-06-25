import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { deleteBackup, readBackupFile } from "@/lib/backup";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/backup/[filename]
 *   Downloads an existing .cbak file (Content-Type: application/octet-stream).
 *   Admin-only.
 *
 * DELETE /api/admin/backup/[filename]
 *   Removes a backup file from BACKUPS_DIR. AuditLog `backup.delete`.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ filename: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { filename } = await ctx.params;

  let result;
  try {
    result = await readBackupFile(filename);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new NextResponse(result.buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(result.sizeBytes),
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ filename: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { filename } = await ctx.params;

  try {
    await deleteBackup(filename, user.id);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "delete failed",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
