/**
 * scripts/rotate-key.ts — Stage 16 master-key rotation.
 *
 * Re-encrypts every encrypted-at-rest file under CHILDCHECK_DATA_KEY_OLD →
 * CHILDCHECK_DATA_KEY (new). Files affected:
 *
 *   - Person photos:    data/photos/<personId>.enc   (re-encrypted in place)
 *   - Branding logo:    data/branding/logo.<ext>     (re-encrypted IF the file
 *                                                      looks encrypted; if it's
 *                                                      a plain file, skipped
 *                                                      with a warning — the
 *                                                      branding logo is
 *                                                      currently stored
 *                                                      unencrypted as a public
 *                                                      asset)
 *
 * Files NOT touched:
 *   - Backup bundles under data/backups/*.cbak stay encrypted with whatever
 *     key they were made with. Document that old backups need the old key to
 *     restore — keep CHILDCHECK_DATA_KEY_OLD available as long as old backups
 *     may need to be restored.
 *
 * Usage:
 *   CHILDCHECK_DATA_KEY_OLD=<old64hex> \
 *   CHILDCHECK_DATA_KEY=<new64hex> \
 *   bun run scripts/rotate-key.ts
 *
 * Both keys MUST be 32 bytes (64 hex chars). Generate a new key with:
 *   openssl rand -hex 32
 *
 * The script writes an AuditLog entry (action: "key.rotation") so there's a
 * tamper-evident record of the rotation.
 *
 * IMPORTANT:
 *   - STOP the ChildCheck server before running this script (otherwise the
 *     server's in-memory Prisma client + file handles may interfere).
 *   - Run `bun run db:push` after rotating if the schema has drifted.
 *   - Test the rotation on a copy of the data dir first.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { PHOTOS_DIR, BRAND_DIR } from "../src/lib/paths";
import { computeAuditHash } from "../src/lib/audit";

const IV_LEN = 12;
const TAG_LEN = 16;

function parseKey(envVar: string, name: string): Buffer {
  const hex = process.env[envVar];
  if (!hex) {
    console.error(
      `[rotate-key] ERROR: ${envVar} is not set. Set both CHILDCHECK_DATA_KEY_OLD (the current key) and CHILDCHECK_DATA_KEY (the new key) in the environment.`,
    );
    process.exit(2);
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    console.error(
      `[rotate-key] ERROR: ${name} must be 32 bytes (64 hex chars), got ${buf.length} bytes.`,
    );
    process.exit(2);
  }
  return buf;
}

function decryptWith(buf: Buffer, key: Buffer): Buffer {
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error(`file too short (${buf.length} bytes)`);
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptWith(plain: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

async function rotateFile(
  filePath: string,
  oldKey: Buffer,
  newKey: Buffer,
): Promise<{ rotated: boolean; reason?: string }> {
  let raw: Buffer;
  try {
    raw = await fs.readFile(filePath);
  } catch (err) {
    return {
      rotated: false,
      reason: `read error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Try to decrypt with the OLD key. If decryption fails (auth tag mismatch
  // → file wasn't encrypted, or was encrypted with a different key), skip.
  let plain: Buffer;
  try {
    plain = decryptWith(raw, oldKey);
  } catch {
    return {
      rotated: false,
      reason: "not encrypted with the old key (skipped)",
    };
  }

  // Re-encrypt with the NEW key + write back.
  const reencrypted = encryptWith(plain, newKey);
  await fs.writeFile(filePath, reencrypted);
  return { rotated: true };
}

async function main() {
  const oldKey = parseKey("CHILDCHECK_DATA_KEY_OLD", "old key");
  const newKey = parseKey("CHILDCHECK_DATA_KEY", "new key");

  if (oldKey.equals(newKey)) {
    console.error(
      "[rotate-key] ERROR: CHILDCHECK_DATA_KEY_OLD and CHILDCHECK_DATA_KEY are identical. Set the NEW key in CHILDCHECK_DATA_KEY before running.",
    );
    process.exit(2);
  }

  console.log("[rotate-key] starting master-key rotation…");
  console.log(`[rotate-key]   old key fingerprint: ${oldKey.subarray(0, 4).toString("hex")}…`);
  console.log(`[rotate-key]   new key fingerprint: ${newKey.subarray(0, 4).toString("hex")}…`);

  const db = new PrismaClient();
  let photosRotated = 0;
  let photosSkipped = 0;
  let brandingRotated = 0;
  let brandingSkipped = 0;
  const errors: string[] = [];

  try {
    // -----------------------------------------------------------------------
    // 1. Person photos.
    // -----------------------------------------------------------------------
    const people = await db.person.findMany({
      where: { photoPath: { not: null } },
      select: { id: true, photoPath: true },
    });
    console.log(`[rotate-key] photos: ${people.length} person(s) with photoPath.`);

    for (const p of people) {
      if (!p.photoPath) continue;
      const filename = path.basename(p.photoPath);
      // Defense: don't follow weird paths.
      if (!/^[\w.-]+\.enc$/.test(filename)) {
        errors.push(`photo ${p.id}: suspicious filename "${filename}" (skipped)`);
        photosSkipped++;
        continue;
      }
      const filePath = path.join(PHOTOS_DIR, filename);
      const result = await rotateFile(filePath, oldKey, newKey);
      if (result.rotated) {
        photosRotated++;
        console.log(`[rotate-key]   ✓ photo ${p.id} (${filename})`);
      } else {
        photosSkipped++;
        console.log(
          `[rotate-key]   - photo ${p.id} (${filename}): ${result.reason ?? "skipped"}`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // 2. Branding logo (if encrypted).
    // -----------------------------------------------------------------------
    let brandEntries: string[] = [];
    try {
      brandEntries = (await fs.readdir(BRAND_DIR)).filter((n) =>
        /^logo\.[a-z0-9.]+$/i.test(n),
      );
    } catch {
      brandEntries = [];
    }
    console.log(`[rotate-key] branding: ${brandEntries.length} logo file(s) found.`);

    for (const name of brandEntries) {
      const filePath = path.join(BRAND_DIR, name);
      const result = await rotateFile(filePath, oldKey, newKey);
      if (result.rotated) {
        brandingRotated++;
        console.log(`[rotate-key]   ✓ branding ${name}`);
      } else {
        brandingSkipped++;
        console.log(
          `[rotate-key]   - branding ${name}: ${result.reason ?? "skipped"}`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // 3. AuditLog entry — key.rotation. Computes the chained hash so the
    //    entry is part of the tamper-evident chain.
    // -----------------------------------------------------------------------
    const auditId = crypto.randomUUID();
    const auditCreatedAt = new Date();
    const prev = await db.auditLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { hash: true },
    });
    const prevHash = prev?.hash ?? null;
    const details = JSON.stringify({
      photosRotated,
      photosSkipped,
      brandingRotated,
      brandingSkipped,
      oldKeyFp: oldKey.subarray(0, 4).toString("hex"),
      newKeyFp: newKey.subarray(0, 4).toString("hex"),
    });
    const hash = computeAuditHash({
      id: auditId,
      action: "key.rotation",
      entity: "System",
      entityId: null,
      details,
      ip: null,
      createdAt: auditCreatedAt,
      prevHash,
    });
    await db.auditLog.create({
      data: {
        id: auditId,
        actorUserId: null,
        action: "key.rotation",
        entity: "System",
        entityId: null,
        details,
        ip: null,
        createdAt: auditCreatedAt,
        prevHash,
        hash,
      },
    });
    console.log("[rotate-key] audit log entry written (action: key.rotation).");
  } catch (err) {
    console.error(
      `[rotate-key] FATAL: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }

  // -----------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------
  console.log("");
  console.log("[rotate-key] rotation complete:");
  console.log(`  Photos:    ${photosRotated} re-encrypted, ${photosSkipped} skipped.`);
  console.log(`  Branding:  ${brandingRotated} re-encrypted, ${brandingSkipped} skipped.`);
  if (errors.length > 0) {
    console.log("");
    console.log("[rotate-key] errors:");
    for (const e of errors) console.log(`  - ${e}`);
  }
  console.log("");
  console.log("[rotate-key] NEXT STEPS:");
  console.log("  1. Update .env / docker-compose.yml / systemd EnvironmentFile:");
  console.log("       CHILDCHECK_DATA_KEY=<the new key>");
  console.log("     (CHILDCHECK_DATA_KEY_OLD can be removed once old backups");
  console.log("      are no longer needed for restore.)");
  console.log("  2. Restart the ChildCheck service.");
  console.log("  3. Verify: open a person detail page → photo loads.");
  console.log("  4. Old backup bundles (*.cbak) are STILL encrypted with the");
  console.log("     old key. Keep CHILDCHECK_DATA_KEY_OLD to restore them.");
}

main().catch((err) => {
  console.error("[rotate-key] uncaught:", err);
  process.exit(1);
});
