import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PHOTOS_DIR } from "@/lib/paths";
import { writeEncryptedFile } from "@/lib/crypto";
import sharp from "sharp";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_DIM = 512;

/**
 * POST /api/admin/people/[id]/photo
 *
 * Upload an encrypted verification photo for a Person.
 *   - Accepts multipart/form-data with field `file` (png/jpg/webp, max 5MB).
 *   - Resizes to max 512×512 preserving aspect ratio (sharp).
 *   - Writes encrypted to PHOTOS_DIR/<personId>.enc (AES-256-GCM).
 *   - Sets Person.photoPath = "people/<personId>.enc" (relative).
 *   - Audit: "person.photo.upload".
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const person = await db.person.findUnique({ where: { id } });
  if (!person) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
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
      { error: `file size must be 1 byte – 5MB (got ${file.size})` },
      { status: 400 },
    );
  }

  const rawBuf = Buffer.from(await file.arrayBuffer());
  const resizedBuf = await sharp(rawBuf)
    .resize(MAX_DIM, MAX_DIM, { fit: "cover", position: "centre" })
    .jpeg({ quality: 85 })
    .toBuffer();

  const filename = `${person.id}.enc`;
  const filepath = path.join(PHOTOS_DIR, filename);
  await writeEncryptedFile(filepath, resizedBuf);

  const photoPath = `people/${filename}`;
  await db.person.update({
    where: { id: person.id },
    data: { photoPath },
  });

  await logAudit({
    actorUserId: user.id,
    action: "person.photo.upload",
    entity: "Person",
    entityId: person.id,
    details: { type: file.type, originalSize: file.size, storedBytes: resizedBuf.length },
  });

  return NextResponse.json({ photoPath });
}

/**
 * DELETE /api/admin/people/[id]/photo
 * Removes the encrypted photo file + clears Person.photoPath.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const person = await db.person.findUnique({ where: { id } });
  if (!person) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (person.photoPath) {
    const filename = path.basename(person.photoPath);
    if (filename === `${person.id}.enc`) {
      try {
        await fs.unlink(path.join(PHOTOS_DIR, filename));
      } catch {
        // best-effort
      }
    }
    await db.person.update({
      where: { id: person.id },
      data: { photoPath: null },
    });
  }

  await logAudit({
    actorUserId: user.id,
    action: "person.photo.remove",
    entity: "Person",
    entityId: person.id,
    details: { removed: true },
  });

  return NextResponse.json({ ok: true });
}
