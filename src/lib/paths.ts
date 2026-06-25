import path from "node:path";

/**
 * Filesystem paths for user-uploaded / generated assets.
 *
 * IMPORTANT: photos, logos and backups live OUTSIDE /public and are served
 * through API routes (so we can apply auth, content-type sniffing and
 * cache headers). This keeps /public reserved for static build assets.
 *
 * Override the root with the CHILDCHECK_DATA_DIR env var for Docker/NAS
 * installs that mount a separate volume.
 */
export const DATA_DIR: string =
  process.env.CHILDCHECK_DATA_DIR || "/home/z/my-project/data";

/** Branding assets — uploaded org logo lives here. */
export const BRAND_DIR: string = path.join(DATA_DIR, "branding");

/** Photos — child + guardian verification photos (Stage 3+). */
export const PHOTOS_DIR: string = path.join(DATA_DIR, "photos");

/** Encrypted backup bundles (Stage 13). */
export const BACKUPS_DIR: string = path.join(DATA_DIR, "backups");
