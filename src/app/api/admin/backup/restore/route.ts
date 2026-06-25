import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { restoreBackup, verifyBundle } from "@/lib/backup";

export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB — DB + photos + branding

/**
 * POST /api/admin/backup/restore
 *   multipart/form-data with `file` (a .cbak file).
 *
 * Workflow:
 *   1. Read the uploaded file bytes.
 *   2. verifyBundle (decrypt + parse). Returns 400 if not a valid .cbak for
 *      this master key (i.e. tampered, truncated, or written under a
 *      different key).
 *   3. (Optional) Dry-run mode (?dryRun=1): just verify, don't restore.
 *   4. Real restore: createBackup("pre-restore") → db.$disconnect() →
 *      overwrite DB + photos + branding → db.$connect() → upsert config →
 *      AuditLog `backup.restore`.
 *   5. Return { ok, preRestoreBackup, message }.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "invalid form data (expected multipart/form-data with a `file` field)" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "missing `file` field" },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { error: "file is empty" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (${file.size} bytes, max ${MAX_BYTES})` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // 1. Verify the bundle. Throws on any failure.
  try {
    await verifyBundle(buf);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Bundle verification failed",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 400 },
    );
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      message: "Bundle is valid. No changes were made.",
    });
  }

  // 2. Real restore.
  try {
    const result = await restoreBackup(buf, user.id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Restore failed",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
