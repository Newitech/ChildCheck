import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { BRAND_DIR } from "@/lib/paths";
import { invalidateOrgConfigCache } from "@/lib/branding";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
]);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
};

async function ensureOrg() {
  const existing = await db.organisation.findFirst();
  if (existing) return existing;
  return db.organisation.create({ data: { id: "default" } });
}

/** Remove any existing logo files in the branding dir. */
async function clearBrandDir(): Promise<void> {
  try {
    const entries = await fs.readdir(BRAND_DIR);
    await Promise.all(
      entries
        .filter((n) => n.startsWith("logo"))
        .map((n) => fs.unlink(path.join(BRAND_DIR, n)).catch(() => {})),
    );
  } catch {
    // dir may not exist yet
  }
}

/**
 * POST /api/admin/branding/logo — multipart/form-data with `file` field.
 * Validates type + size, saves to data/branding/logo<ext>, updates Org.logoUrl.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported type: ${file.type}` },
      { status: 400 },
    );
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file size must be 1 byte – 2MB (got ${file.size})` },
      { status: 400 },
    );
  }

  await fs.mkdir(BRAND_DIR, { recursive: true });
  await clearBrandDir();

  const ext = EXT_BY_TYPE[file.type] ?? ".bin";
  const filename = `logo${ext}`;
  const filepath = path.join(BRAND_DIR, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filepath, buf);

  const org = await ensureOrg();
  await db.organisation.update({
    where: { id: org.id },
    data: { logoUrl: filename },
  });
  invalidateOrgConfigCache();
  await logAudit({
    actorUserId: user.id,
    action: "branding.logo",
    entity: "Organisation",
    entityId: org.id,
    details: { filename, type: file.type, size: file.size },
  });

  return NextResponse.json({ logoUrl: filename });
}

/** DELETE /api/admin/branding/logo — remove the logo file + clear Org.logoUrl. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const org = await ensureOrg();
  await clearBrandDir();
  await db.organisation.update({
    where: { id: org.id },
    data: { logoUrl: null },
  });
  invalidateOrgConfigCache();
  await logAudit({
    actorUserId: user.id,
    action: "branding.logo",
    entity: "Organisation",
    entityId: org.id,
    details: { removed: true },
  });
  return NextResponse.json({ ok: true });
}
