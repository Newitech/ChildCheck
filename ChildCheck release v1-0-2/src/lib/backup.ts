import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { writeEncryptedFile, readEncryptedFile } from "@/lib/crypto";
import { BACKUPS_DIR, PHOTOS_DIR, BRAND_DIR, DATA_DIR } from "@/lib/paths";
import { getFeatureFlag } from "@/lib/feature-flags";

/**
 * Stage 13 — Backup & Restore.
 *
 * The ChildCheck backup bundle (`.cbak`) is an ENCRYPTED JSON document:
 *
 *   1. The in-memory bundle (BackupBundle below) is a JSON object whose binary
 *      fields (the SQLite DB bytes, the encrypted photo bytes, the logo bytes)
 *      are base64-encoded so they survive JSON.stringify.
 *   2. The whole JSON string is UTF-8 encoded and AES-256-GCM encrypted via
 *      `writeEncryptedFile` (same primitive used for photos). On-disk format
 *      is therefore `[iv (12)][tag (16)][ciphertext (rest)]` — identical to
 *      every other encrypted file in `data/`.
 *   3. The 12+16 byte header plus the GCM auth tag mean a `.cbak` file is
 *      unreadable without `CHILDCHECK_DATA_KEY`. `file` reports "data".
 *
 * The bundle captures EVERYTHING needed to restore the system to the snapshot
 * state: the SQLite DB file (people, families, programs, audit log, …), every
 * encrypted photo, the brand logo, and the Organisation + FeatureFlag config
 * rows (belt-and-braces — they're already in the DB bytes, but stored
 * separately so config can be re-applied even if the DB schema drifts).
 *
 * Restore workflow:
 *   1. Verify the bundle (decrypt + parse — fails loudly if not a valid
 *      `.cbak` for this master key).
 *   2. ALWAYS create a pre-restore backup first (suffix "pre-restore"), so a
 *      failed restore can be rolled back.
 *   3. Disconnect Prisma.
 *   4. Overwrite the SQLite DB file with the bundle's DB bytes.
 *   5. Rewrite every photo to PHOTOS_DIR/<personId>.enc (the photos in the
 *      bundle are already encrypted with the master key — store as-is).
 *   6. Rewrite the brand logo.
 *   7. Reconnect Prisma + upsert Organisation + FeatureFlags from the
 *      bundle's config JSON (best-effort — wrapped in try/catch so a schema
 *      drift doesn't fail an otherwise successful DB restore).
 *   8. AuditLog `backup.restore`.
 *
 * IMPORTANT — overwriting SQLite while Prisma has it open:
 *   - We call `db.$disconnect()` before the file overwrite. SQLite (in WAL
 *     mode, which Prisma enables by default for SQLite) flushes + closes the
 *     file cleanly on disconnect.
 *   - After the overwrite, the next Prisma query lazily re-opens the file.
 *     In dev (hot-reload), the global Prisma singleton may still hold a
 *     cached connection — for a production restore we recommend running the
 *     restore via the CLI / a maintenance mode where the server process is
 *     stopped and restarted. The HTTP API returns a "please restart" message
 *     to make this clear to the operator.
 */

export const BUNDLE_VERSION = 1;

/** Filename-safe timestamp tag (UTC). */
function timestampTag(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/** Filename for a backup. suffix is "pre-restore" or undefined. */
function backupFilename(suffix?: string): string {
  const tag = timestampTag();
  const middle = suffix ? `-${suffix}` : "";
  return `childcheck-backup-${tag}${middle}.cbak`;
}

/**
 * Resolve the absolute SQLite DB file path from DATABASE_URL.
 * Accepts `file:/abs/path.db`, `file:./rel/path.db`, or `file:rel/path.db`.
 */
export function getDbFilePath(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) {
    throw new Error(`DATABASE_URL must start with "file:" — got "${url}"`);
  }
  const raw = url.slice("file:".length);
  // Absolute paths start with "/" on POSIX or match the Windows drive pattern.
  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) {
    return raw;
  }
  // Relative path — resolve against the project root.
  return path.resolve(process.cwd(), raw);
}

// ---------------------------------------------------------------------------
// Bundle types
// ---------------------------------------------------------------------------

/** The in-memory bundle (before JSON serialization + encryption). */
export interface BackupBundle {
  version: number;
  createdAt: string;
  /** The SQLite DB file bytes. */
  db: Buffer;
  /** personId -> encrypted photo bytes (already encrypted on disk; stored as-is). */
  photos: Record<string, Buffer>;
  /** Brand logo file (raw bytes — logos are NOT encrypted on disk). */
  branding: { logo?: Buffer; logoFilename?: string };
  /** Org + flags as JSON (belt-and-braces — they're also in the DB bytes). */
  config: {
    organisation: Record<string, unknown> | null;
    featureFlags: Array<{ key: string; value: boolean; updatedBy: string | null }>;
  };
}

/**
 * The JSON-serializable shape (binary fields base64-encoded so the whole
 * thing can go through JSON.stringify before encryption).
 */
interface SerializableBundle {
  version: number;
  createdAt: string;
  db: string; // base64
  photos: Record<string, string>; // personId -> base64
  branding: { logo?: string; logoFilename?: string };
  config: {
    organisation: Record<string, unknown> | null;
    featureFlags: Array<{ key: string; value: boolean; updatedBy: string | null }>;
  };
}

// ---------------------------------------------------------------------------
// Create backup
// ---------------------------------------------------------------------------

export interface CreateBackupResult {
  /** The encrypted .cbak bytes (ready to send as a download). */
  buffer: Buffer;
  /** The filename (also the file name written under BACKUPS_DIR). */
  filename: string;
  /** Absolute path on disk. */
  path: string;
  /** Number of photos included. */
  photoCount: number;
  /** Size of the encrypted bundle in bytes. */
  sizeBytes: number;
}

/**
 * Create an encrypted backup bundle and write it to BACKUPS_DIR.
 * Returns the encrypted bytes (for HTTP download) + the filename + metadata.
 *
 * Pass `suffix` to mark a pre-restore backup.
 */
export async function createBackup(
  suffix?: string,
  actorUserId?: string,
): Promise<CreateBackupResult> {
  // 1. Read the SQLite DB file bytes.
  const dbPath = getDbFilePath();
  const dbBytes = await fs.readFile(dbPath);

  // 2. Read every photo in PHOTOS_DIR (each file is "<personId>.enc").
  const photos: Record<string, Buffer> = {};
  try {
    const photoEntries = await fs.readdir(PHOTOS_DIR);
    for (const name of photoEntries) {
      if (!name.endsWith(".enc")) continue;
      const personId = name.slice(0, -".enc".length);
      // Skip the bundle if it ever ended up in the photos dir by mistake.
      if (!personId) continue;
      photos[personId] = await fs.readFile(path.join(PHOTOS_DIR, name));
    }
  } catch {
    // PHOTOS_DIR may not exist yet on a fresh install.
  }

  // 3. Read the brand logo (if any). Logos are stored as raw bytes
  // (NOT encrypted — they're served to anonymous kiosk clients). We pick
  // any file starting with "logo" in BRAND_DIR.
  const branding: { logo?: Buffer; logoFilename?: string } = {};
  try {
    const brandEntries = await fs.readdir(BRAND_DIR);
    const logoName = brandEntries.find((n) => n.startsWith("logo"));
    if (logoName) {
      branding.logo = await fs.readFile(path.join(BRAND_DIR, logoName));
      branding.logoFilename = logoName;
    }
  } catch {
    // BRAND_DIR may not exist yet.
  }

  // 4. Read Organisation + FeatureFlags from the DB.
  let organisation: Record<string, unknown> | null = null;
  let featureFlags: Array<{ key: string; value: boolean; updatedBy: string | null }> = [];
  try {
    const org = await db.organisation.findFirst();
    if (org) {
      // Strip the Prisma-specific bits we don't want to re-apply (createdAt
      // / updatedAt — these are managed by the DB on upsert).
      organisation = org as unknown as Record<string, unknown>;
    }
    const flagRows = await db.featureFlag.findMany();
    featureFlags = flagRows.map((r) => ({
      key: r.key,
      value: r.value,
      updatedBy: r.updatedBy,
    }));
  } catch {
    // DB not ready — skip config capture.
  }

  // 5. Assemble the in-memory bundle.
  const bundle: BackupBundle = {
    version: BUNDLE_VERSION,
    createdAt: new Date().toISOString(),
    db: dbBytes,
    photos,
    branding,
    config: { organisation, featureFlags },
  };

  // 6. Serialize to JSON (with base64 binary fields) + encrypt.
  const serializable: SerializableBundle = {
    version: bundle.version,
    createdAt: bundle.createdAt,
    db: bundle.db.toString("base64"),
    photos: Object.fromEntries(
      Object.entries(bundle.photos).map(([k, v]) => [k, v.toString("base64")]),
    ),
    branding: {
      ...(bundle.branding.logo
        ? { logo: bundle.branding.logo.toString("base64") }
        : {}),
      ...(bundle.branding.logoFilename
        ? { logoFilename: bundle.branding.logoFilename }
        : {}),
    },
    config: bundle.config,
  };

  const jsonBytes = Buffer.from(JSON.stringify(serializable), "utf8");
  const filename = backupFilename(suffix);
  const outPath = path.join(BACKUPS_DIR, filename);
  await writeEncryptedFile(outPath, jsonBytes);
  const encrypted = await fs.readFile(outPath);

  // 7. Audit log. We always use the `backup.create` action (matching the
  // spec); the suffix is preserved in details. NOTE: when this is a
  // pre-restore backup, the audit entry is written to the OLD DB and will
  // be overwritten by the restore (which replaces the DB file). The
  // subsequent `backup.restore` entry records the pre-restore filename so
  // the operator can still see a pre-restore backup was made. The
  // pre-restore audit entry itself is preserved inside the backup file
  // (its DB bytes include it).
  await logAudit({
    actorUserId: actorUserId ?? null,
    action: "backup.create",
    entity: "Backup",
    entityId: filename,
    details: {
      filename,
      sizeBytes: encrypted.length,
      dbBytes: dbBytes.length,
      photoCount: Object.keys(photos).length,
      hasLogo: !!branding.logo,
      suffix: suffix ?? null,
    },
  });

  return {
    buffer: encrypted,
    filename,
    path: outPath,
    photoCount: Object.keys(photos).length,
    sizeBytes: encrypted.length,
  };
}

// ---------------------------------------------------------------------------
// Restore backup
// ---------------------------------------------------------------------------

export interface RestoreResult {
  ok: true;
  preRestoreBackup: string;
  message: string;
  photoCount: number;
  hadLogo: boolean;
}

/**
 * Verify a .cbak buffer is decryptable + parseable.
 * Throws on any failure (wrong key, truncated, tampered, bad JSON).
 * Returns the parsed in-memory bundle.
 */
export async function verifyBundle(
  encryptedBuffer: Buffer,
): Promise<BackupBundle> {
  // readEncryptedFile reads from disk — but we already have the bytes.
  // We inline the same logic to operate on an in-memory buffer.
  const IV_LEN = 12;
  const TAG_LEN = 16;
  if (encryptedBuffer.length < IV_LEN + TAG_LEN) {
    throw new Error(
      `Bundle too short (${encryptedBuffer.length} bytes) — not a valid .cbak file`,
    );
  }
  // Use the crypto module's readEncryptedFile by writing to a temp path? No —
  // we replicate the decrypt inline because the buffer is already in memory.
  // Import the decrypt primitive lazily to avoid a circular type issue.
  const { decrypt } = await import("@/lib/crypto");
  const iv = encryptedBuffer.subarray(0, IV_LEN);
  const tag = encryptedBuffer.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = encryptedBuffer.subarray(IV_LEN + TAG_LEN);
  const jsonBytes = decrypt(iv, tag, ciphertext);
  const jsonStr = jsonBytes.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Bundle JSON is unparseable — file may be corrupted");
  }
  return normaliseBundle(parsed);
}

/** Cast the parsed JSON back to a strongly-typed bundle, validating shape. */
function normaliseBundle(parsed: unknown): BackupBundle {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Bundle is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== "number") {
    throw new Error('Bundle missing "version" number');
  }
  if (typeof obj.createdAt !== "string") {
    throw new Error('Bundle missing "createdAt" string');
  }
  if (typeof obj.db !== "string") {
    throw new Error('Bundle missing "db" base64 string');
  }
  if (typeof obj.photos !== "object" || obj.photos === null) {
    throw new Error('Bundle missing "photos" object');
  }
  if (typeof obj.config !== "object" || obj.config === null) {
    throw new Error('Bundle missing "config" object');
  }

  const photosRaw = obj.photos as Record<string, unknown>;
  const photos: Record<string, Buffer> = {};
  for (const [k, v] of Object.entries(photosRaw)) {
    if (typeof v !== "string") {
      throw new Error(`Photo for personId "${k}" is not a base64 string`);
    }
    photos[k] = Buffer.from(v, "base64");
  }

  const brandingRaw =
    typeof obj.branding === "object" && obj.branding !== null
      ? (obj.branding as Record<string, unknown>)
      : {};
  const branding: { logo?: Buffer; logoFilename?: string } = {};
  if (typeof brandingRaw.logo === "string") {
    branding.logo = Buffer.from(brandingRaw.logo, "base64");
  }
  if (typeof brandingRaw.logoFilename === "string") {
    branding.logoFilename = brandingRaw.logoFilename;
  }

  const configRaw = obj.config as Record<string, unknown>;
  const organisation =
    typeof configRaw.organisation === "object" && configRaw.organisation !== null
      ? (configRaw.organisation as Record<string, unknown>)
      : null;
  if (!Array.isArray(configRaw.featureFlags)) {
    throw new Error('Bundle config.featureFlags is not an array');
  }
  const featureFlags = (configRaw.featureFlags as unknown[]).map((f, i) => {
    if (typeof f !== "object" || f === null) {
      throw new Error(`Bundle config.featureFlags[${i}] is not an object`);
    }
    const fr = f as Record<string, unknown>;
    if (typeof fr.key !== "string") {
      throw new Error(`Bundle config.featureFlags[${i}].key is not a string`);
    }
    if (typeof fr.value !== "boolean") {
      throw new Error(`Bundle config.featureFlags[${i}].value is not a boolean`);
    }
    return {
      key: fr.key,
      value: fr.value,
      updatedBy:
        typeof fr.updatedBy === "string" ? fr.updatedBy : null,
    };
  });

  return {
    version: obj.version,
    createdAt: obj.createdAt,
    db: Buffer.from(obj.db, "base64"),
    photos,
    branding,
    config: { organisation, featureFlags },
  };
}

/**
 * Restore the system from a .cbak buffer.
 *
 * Steps:
 *   1. verifyBundle (decrypt + parse).
 *   2. createBackup("pre-restore") — automatic pre-restore safety net.
 *   3. db.$disconnect() — flush + close the SQLite file.
 *   4. Overwrite the DB file with the bundle's db bytes.
 *   5. Rewrite every photo in PHOTOS_DIR.
 *   6. Rewrite the brand logo.
 *   7. db.$connect() + upsert Organisation + FeatureFlags from bundle config.
 *   8. AuditLog `backup.restore`.
 *
 * Returns metadata describing what was restored.
 */
export async function restoreBackup(
  encryptedBuffer: Buffer,
  actorUserId?: string,
): Promise<RestoreResult> {
  // 1. Verify the bundle first. Throws on any failure → caller returns 400.
  const bundle = await verifyBundle(encryptedBuffer);

  // 2. Pre-restore safety backup.
  const preRestore = await createBackup("pre-restore", actorUserId);

  // 3. Disconnect Prisma so we can safely overwrite the SQLite file.
  try {
    await db.$disconnect();
  } catch {
    // best-effort — proceed to file overwrite regardless
  }

  // 4. Overwrite the DB file.
  const dbPath = getDbFilePath();
  // Ensure the parent dir exists (it should — but be defensive).
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, bundle.db);

  // 5. Rewrite every photo. The bundle stores photos already-encrypted
  // (iv+tag+ciphertext) so we write them verbatim.
  await fs.mkdir(PHOTOS_DIR, { recursive: true });
  for (const [personId, bytes] of Object.entries(bundle.photos)) {
    // Sanitize personId — only allow non-empty safe chars to prevent path
    // traversal. CUIDs are alphanumeric + lowercase.
    if (!/^[A-Za-z0-9_-]+$/.test(personId)) {
      continue;
    }
    await fs.writeFile(path.join(PHOTOS_DIR, `${personId}.enc`), bytes);
  }

  // 6. Rewrite the brand logo (if any). If the bundle has no logo, leave
  // the existing logo alone (we don't want to nuke it on a partial restore).
  if (bundle.branding.logo && bundle.branding.logoFilename) {
    await fs.mkdir(BRAND_DIR, { recursive: true });
    // Sanitize filename — only allow typical logo extensions.
    if (/^logo\.(png|jpe?g|svg|webp)$/i.test(bundle.branding.logoFilename)) {
      await fs.writeFile(
        path.join(BRAND_DIR, bundle.branding.logoFilename),
        bundle.branding.logo,
      );
    }
  }

  // 7. Reconnect Prisma + re-apply config from the bundle JSON. Best-effort:
  // wrap in try/catch so a schema drift on the Org/FeatureFlag row doesn't
  // fail an otherwise-successful DB restore.
  let configApplied = false;
  try {
    await db.$connect();
    const orgRow = bundle.config.organisation;
    if (orgRow && typeof orgRow.id === "string") {
      // Re-apply just the safe-to-overwrite fields (avoid clobbering
      // createdAt/updatedAt which are DB-managed).
      const data = {
        name: typeof orgRow.name === "string" ? orgRow.name : undefined,
        appName: typeof orgRow.appName === "string" ? orgRow.appName : undefined,
        tagline: typeof orgRow.tagline === "string" ? orgRow.tagline : undefined,
        primaryColor:
          typeof orgRow.primaryColor === "string" ? orgRow.primaryColor : undefined,
        accentColor:
          typeof orgRow.accentColor === "string" ? orgRow.accentColor : undefined,
        logoUrl:
          typeof orgRow.logoUrl === "string" || orgRow.logoUrl === null
            ? orgRow.logoUrl
            : undefined,
        terminology:
          typeof orgRow.terminology === "string" ? orgRow.terminology : undefined,
        orgType: typeof orgRow.orgType === "string" ? orgRow.orgType : undefined,
        weekStartsOn:
          typeof orgRow.weekStartsOn === "number" ? orgRow.weekStartsOn : undefined,
        dailyCodeLength:
          typeof orgRow.dailyCodeLength === "number"
            ? orgRow.dailyCodeLength
            : undefined,
        dailyCodeCharset:
          typeof orgRow.dailyCodeCharset === "string"
            ? orgRow.dailyCodeCharset
            : undefined,
      };
      // Strip undefined values.
      const cleanData = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(cleanData).length > 0) {
        await db.organisation.upsert({
          where: { id: orgRow.id },
          create: { id: orgRow.id, ...(cleanData as Record<string, unknown>) },
          update: cleanData,
        });
      }
    }
    for (const f of bundle.config.featureFlags) {
      await db.featureFlag.upsert({
        where: { key: f.key },
        create: { key: f.key, value: f.value, updatedBy: f.updatedBy },
        update: { value: f.value, updatedBy: f.updatedBy },
      });
    }
    configApplied = true;
  } catch (err) {
    // Log to stderr — the DB bytes already contain the Org/Flag rows, so a
    // failure here is informational only.
    console.error("[backup.restore] config re-apply failed (non-fatal):", err);
  }

  // 8. Audit log. Best-effort (audit.ts already swallows errors).
  try {
    await logAudit({
      actorUserId: actorUserId ?? null,
      action: "backup.restore",
      entity: "Backup",
      entityId: preRestore.filename,
      details: {
        preRestoreBackup: preRestore.filename,
        photoCount: Object.keys(bundle.photos).length,
        hadLogo: !!bundle.branding.logo,
        configApplied,
        bundleCreatedAt: bundle.createdAt,
        bundleVersion: bundle.version,
      },
    });
  } catch {
    /* swallow */
  }

  return {
    ok: true,
    preRestoreBackup: preRestore.filename,
    message:
      "Restore complete. Restart the server for changes to take full effect.",
    photoCount: Object.keys(bundle.photos).length,
    hadLogo: !!bundle.branding.logo,
  };
}

// ---------------------------------------------------------------------------
// List + delete
// ---------------------------------------------------------------------------

export interface BackupListItem {
  filename: string;
  sizeBytes: number;
  createdAt: string; // ISO
}

/** Lists every .cbak file in BACKUPS_DIR, newest first. */
export async function listBackups(): Promise<BackupListItem[]> {
  let entries: fssync.Dirent[] = [];
  try {
    entries = await fs.readdir(BACKUPS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: BackupListItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".cbak")) continue;
    const full = path.join(BACKUPS_DIR, entry.name);
    const stat = await fs.stat(full);
    items.push({
      filename: entry.name,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
    });
  }
  // Sort newest first by mtime, then by filename for stable ordering.
  items.sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    return a.filename < b.filename ? 1 : -1;
  });
  return items;
}

/** Delete a backup file by filename. Validates the name to prevent traversal. */
export async function deleteBackup(
  filename: string,
  actorUserId?: string,
): Promise<void> {
  // Sanitize: only allow the canonical filename shape.
  if (!/^childcheck-backup-\d{4}-\d{2}-\d{2}-\d{6}(-pre-restore)?\.cbak$/.test(filename)) {
    throw new Error(`Invalid backup filename: ${filename}`);
  }
  const full = path.join(BACKUPS_DIR, filename);
  // Guard against traversal (belt-and-braces — the regex already excludes ../).
  const resolved = path.resolve(full);
  const resolvedRoot = path.resolve(BACKUPS_DIR);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error("Invalid backup path");
  }
  await fs.unlink(full);
  await logAudit({
    actorUserId: actorUserId ?? null,
    action: "backup.delete",
    entity: "Backup",
    entityId: filename,
    details: { filename },
  });
}

/** Read an existing .cbak file's encrypted bytes (for download). */
export async function readBackupFile(
  filename: string,
): Promise<{ buffer: Buffer; sizeBytes: number }> {
  if (!/^childcheck-backup-\d{4}-\d{2}-\d{2}-\d{6}(-pre-restore)?\.cbak$/.test(filename)) {
    throw new Error(`Invalid backup filename: ${filename}`);
  }
  const full = path.join(BACKUPS_DIR, filename);
  const resolved = path.resolve(full);
  const resolvedRoot = path.resolve(BACKUPS_DIR);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error("Invalid backup path");
  }
  const buffer = await fs.readFile(full);
  return { buffer, sizeBytes: buffer.length };
}

// ---------------------------------------------------------------------------
// Scheduled backup (per `scheduled_backups` flag)
// ---------------------------------------------------------------------------

const SCHEDULED_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
let lastScheduledCheckAt = 0;
const SCHEDULED_CHECK_COOLDOWN_MS = 60 * 1000; // 1 min — don't hammer the FS

/**
 * Lightweight scheduled-backup check. Idempotent — safe to call on every
 * `/api/admin/backup/tick` request or any admin page load.
 *
 * Behaviour:
 *   - If `scheduled_backups` flag is OFF → no-op.
 *   - If flag is ON and the most recent .cbak in BACKUPS_DIR is older than
 *     24h (or there are no backups yet) → create one.
 *   - Cooldown: at most one check per minute to avoid hammering the FS.
 *
 * Production deployments should use a real scheduler (systemd timer / cron /
 * Windows Task Scheduler) instead of relying on web traffic. Example cron:
 *
 *   0 2 * * *  curl -fsS -X POST \
 *       -H "Cookie: $AUTH_COOKIE" \
 *       http://localhost:3000/api/admin/backup/tick
 *
 * Or via a CLI script (a future Stage 16 will add `bun run scripts/backup.ts`).
 *
 * Retention: a future Stage 16 will add configurable retention (e.g. keep
 * last 30 daily + 12 monthly). For Stage 13, scheduled backups accumulate
 * indefinitely in BACKUPS_DIR — the admin can delete old ones from the UI.
 */
export async function scheduledBackupIfDue(
  actorUserId?: string,
): Promise<{ created: boolean; filename?: string; reason?: string }> {
  // Cooldown — avoid re-running on every request.
  const now = Date.now();
  if (now - lastScheduledCheckAt < SCHEDULED_CHECK_COOLDOWN_MS) {
    return { created: false, reason: "cooldown" };
  }
  lastScheduledCheckAt = now;

  const enabled = await getFeatureFlag("scheduled_backups");
  if (!enabled) {
    return { created: false, reason: "flag_off" };
  }

  const backups = await listBackups();
  // Filter out pre-restore backups — they don't count as "scheduled" coverage.
  const scheduled = backups.filter((b) => !b.filename.includes("-pre-restore"));
  if (scheduled.length > 0) {
    const newest = scheduled[0]; // already sorted newest-first
    const newestAt = new Date(newest.createdAt).getTime();
    if (now - newestAt < SCHEDULED_BACKUP_INTERVAL_MS) {
      return { created: false, reason: "too_recent" };
    }
  }

  const result = await createBackup(undefined, actorUserId);
  return { created: true, filename: result.filename };
}

/** Re-export for tests / external callers. */
export { BACKUPS_DIR, DATA_DIR };
