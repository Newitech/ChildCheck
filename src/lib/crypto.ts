import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Encryption-at-rest primitives for ChildCheck.
 *
 * Uses Node's built-in `crypto` module with AES-256-GCM (authenticated
 * encryption). The same pattern is used for photos (Stage 3) and will be
 * used for backup bundles (Stage 13/16).
 *
 * Master key:
 *   - 32 bytes (64 hex chars).
 *   - Sourced from CHILDCHECK_DATA_KEY env var. In dev, a stable key is
 *     derived from a fixed seed so photos round-trip on a single instance.
 *   - In production this MUST be set to a strong random key and stored
 *     securely (e.g. Docker secret / systemd EnvironmentFile / NAS keyring).
 *
 * On-disk file format (single concatenated file):
 *   [12-byte iv][16-byte auth tag][rest = ciphertext]
 *
 * Rotation strategy (Stage 16): re-encrypt every file under the new key.
 * The format itself is version-agnostic; we do not prepend a version byte
 * because the key identity is implicit from the env. A future key-id header
 * could be added if multi-key rotation is needed.
 */

/**
 * Lazily-resolved master key. We do NOT resolve it at module-import time
 * because `next build` imports this module during page-data collection, when
 * the env var isn't set yet — throwing then breaks the build. Instead we
 * resolve on first use (encrypt/decrypt) + memoise.
 *
 * Resolution order:
 *   1. CHILDCHECK_DATA_KEY env var (production — set in .env / docker env).
 *   2. Stable dev key (NOT for production). SHA-256 of a fixed seed gives a
 *      32-byte key whose hex repr is exactly 64 chars.
 */
let _masterKey: Buffer | null = null;
function getMasterKey(): Buffer {
  if (_masterKey) return _masterKey;
  const hex =
    process.env.CHILDCHECK_DATA_KEY ||
    crypto.createHash("sha256").update("childcheck-dev-seed").digest("hex");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      `CHILDCHECK_DATA_KEY must be 32 bytes (64 hex chars), got ${key.length} bytes`,
    );
  }
  _masterKey = key;
  return key;
}

const IV_LEN = 12; // 96-bit IV (GCM standard)
const TAG_LEN = 16; // 128-bit auth tag

export interface EncryptedParts {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

export function encrypt(buffer: Buffer): EncryptedParts {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ciphertext };
}

export function decrypt(iv: Buffer, tag: Buffer, ciphertext: Buffer): Buffer {
  if (iv.length !== IV_LEN) {
    throw new Error(`decrypt: iv must be ${IV_LEN} bytes, got ${iv.length}`);
  }
  if (tag.length !== TAG_LEN) {
    throw new Error(`decrypt: tag must be ${TAG_LEN} bytes, got ${tag.length}`);
  }
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Write an encrypted file to disk. Format:
 *   [iv (12 bytes)][tag (16 bytes)][ciphertext (rest)]
 */
export async function writeEncryptedFile(
  filePath: string,
  buffer: Buffer,
): Promise<void> {
  const { iv, tag, ciphertext } = encrypt(buffer);
  const out = Buffer.concat([iv, tag, ciphertext]);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, out);
}

/**
 * Read + decrypt a file written by writeEncryptedFile.
 * Throws if the auth tag does not verify (i.e. the file was tampered with
 * or written under a different key).
 */
export async function readEncryptedFile(filePath: string): Promise<Buffer> {
  const raw = await fs.readFile(filePath);
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error(
      `readEncryptedFile: file too short (${raw.length} bytes, need ≥${IV_LEN + TAG_LEN})`,
    );
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  return decrypt(iv, tag, ciphertext);
}
