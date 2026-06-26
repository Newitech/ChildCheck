import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ChildCheck version + GitHub release update checker.
 *
 * The version is read from the project-root `VERSION` file (or `/app/VERSION`
 * inside the Docker image, or one directory up when running from a Bun
 * standalone binary bundle). The version is cached on first read for the
 * lifetime of the process.
 *
 * `checkForUpdate()` performs a READ-ONLY fetch against the GitHub releases
 * API for the configured public repo. It never writes to the install —
 * applying an update is always an external, operator-initiated action
 * (see `install/childcheck-update.sh` or `docker compose pull`).
 *
 * The repo is configured via the `CHILDCHECK_UPDATE_REPO` env var, e.g.
 * `CHILDCHECK_UPDATE_REPO=childcheck/childcheck`. When unset, update
 * checking is disabled and `checkForUpdate()` returns a disabled-state
 * `UpdateStatus` without touching the network.
 *
 * Results are cached for 1 hour so repeated admin page loads don't hammer
 * the GitHub API (which is rate-limited to 60 req/hour per IP for
 * unauthenticated requests).
 */

let cachedVersion: string | null = null;

/** The installed ChildCheck version (from the VERSION file, cached). */
export function getVersion(): string {
  if (cachedVersion) return cachedVersion;
  // VERSION lives at the project root in dev, in /app/ in the Docker image,
  // and one directory up from the binary in a Bun standalone bundle.
  const paths = [
    join(process.cwd(), "VERSION"),
    join(process.cwd(), "..", "VERSION"),
    "/app/VERSION",
  ];
  for (const p of paths) {
    try {
      cachedVersion = readFileSync(p, "utf8").trim();
      if (cachedVersion) return cachedVersion;
    } catch {
      /* try next path */
    }
  }
  cachedVersion = "0.0.0-dev";
  return cachedVersion;
}

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

export interface ReleaseInfo {
  latestVersion: string;
  publishedAt: string;
  releaseNotes: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
}

export interface UpdateStatus {
  installedVersion: string;
  latest?: ReleaseInfo;
  updateAvailable: boolean;
  checkedAt: string;
  /** Set when the checker is disabled (no repo configured) or failed. */
  error?: string;
  /** True when the checker is disabled because no repo is configured. */
  disabled?: boolean;
}

interface CachedResult {
  at: number;
  status: UpdateStatus;
}

// In-memory 1-hour cache. Single-flight within a process.
let cache: CachedResult | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Repo slug for the GitHub releases API (e.g. "childcheck/childcheck"). */
function getUpdateRepo(): string | null {
  const raw = process.env.CHILDCHECK_UPDATE_REPO?.trim();
  if (!raw) return null;
  // Be lenient about leading/trailing slashes or a full URL.
  const stripped = raw
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^\/+|\/+$/g, "");
  if (!stripped || !stripped.includes("/")) return null;
  return stripped;
}

/**
 * Compare two semver-ish strings ("1.2.3", "v1.2.3", "1.2.3-rc1").
 * Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
    v
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

interface GithubReleaseResponse {
  tag_name?: string;
  name?: string;
  published_at?: string;
  html_url?: string;
  body?: string;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
    size?: number;
  }>;
}

/**
 * Fetch the latest release from GitHub. The repo is configured via env var
 * `CHILDCHECK_UPDATE_REPO` (e.g. "childcheck/childcheck"). If unset, the
 * checker is disabled. Calls the GitHub releases API read-only (no auth,
 * public repos only). 5s timeout. Cached for 1 hour.
 *
 * On any error (network failure, repo not found, rate-limit), returns an
 * `UpdateStatus` with `updateAvailable: false` + an `error` message — never
 * throws.
 */
export async function checkForUpdate(opts?: {
  /** Bypass the 1-hour cache (used by the admin "Check now" button). */
  force?: boolean;
}): Promise<UpdateStatus> {
  const installedVersion = getVersion();
  const checkedAt = new Date().toISOString();

  if (cache && !opts?.force && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.status, checkedAt };
  }

  const repo = getUpdateRepo();
  if (!repo) {
    const status: UpdateStatus = {
      installedVersion,
      updateAvailable: false,
      checkedAt,
      disabled: true,
      error:
        "Update checking is disabled. Set CHILDCHECK_UPDATE_REPO (e.g. childcheck/childcheck) to enable.",
    };
    cache = { at: Date.now(), status };
    return status;
  }

  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ChildCheck-update-checker",
      },
      cache: "no-store",
    });

    if (res.status === 404) {
      const status: UpdateStatus = {
        installedVersion,
        updateAvailable: false,
        checkedAt,
        error: `No releases found for ${repo}. Publish a GitHub release to enable update checks.`,
      };
      cache = { at: Date.now(), status };
      return status;
    }

    if (res.status === 403) {
      // Rate-limited or forbidden. GitHub sets X-RateLimit-Remaining: 0.
      const remaining = res.headers.get("x-ratelimit-remaining");
      const resetEpoch = res.headers.get("x-ratelimit-reset");
      const retryMsg = resetEpoch
        ? ` Retry after ${new Date(parseInt(resetEpoch, 10) * 1000).toISOString()}.`
        : "";
      const status: UpdateStatus = {
        installedVersion,
        updateAvailable: false,
        checkedAt,
        error:
          remaining === "0"
            ? `GitHub API rate limit exceeded.${retryMsg}`
            : `GitHub API returned 403 for ${repo}.`,
      };
      cache = { at: Date.now(), status };
      return status;
    }

    if (!res.ok) {
      const status: UpdateStatus = {
        installedVersion,
        updateAvailable: false,
        checkedAt,
        error: `GitHub API returned HTTP ${res.status} for ${repo}.`,
      };
      cache = { at: Date.now(), status };
      return status;
    }

    const data = (await res.json()) as GithubReleaseResponse;
    const latestVersion = (data.tag_name ?? "").replace(/^v/i, "").trim();
    if (!latestVersion) {
      const status: UpdateStatus = {
        installedVersion,
        updateAvailable: false,
        checkedAt,
        error: `Latest release for ${repo} has no tag_name.`,
      };
      cache = { at: Date.now(), status };
      return status;
    }

    const release: ReleaseInfo = {
      latestVersion,
      publishedAt: data.published_at ?? checkedAt,
      releaseNotes: data.body ?? "",
      htmlUrl: data.html_url ?? `https://github.com/${repo}/releases/latest`,
      assets: (data.assets ?? []).map((a) => ({
        name: a.name ?? "",
        downloadUrl: a.browser_download_url ?? "",
        size: a.size ?? 0,
      })),
    };

    const status: UpdateStatus = {
      installedVersion,
      latest: release,
      updateAvailable: compareVersions(latestVersion, installedVersion) > 0,
      checkedAt,
    };
    cache = { at: Date.now(), status };
    return status;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status: UpdateStatus = {
      installedVersion,
      updateAvailable: false,
      checkedAt,
      error: `Update check failed: ${msg}`,
    };
    // Don't cache network failures for the full hour — cache for 5 minutes so
    // the admin "Check now" button can retry sooner.
    cache = { at: Date.now() - (CACHE_TTL_MS - 5 * 60 * 1000), status };
    return status;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The appropriate update command for this install.
 *
 * - Docker:        `docker compose pull && docker compose up -d`
 * - Native:        `sudo bash install/childcheck-update.sh`
 *
 * Detection: if `CHILDCHECK_DOCKER` is set (the Docker entrypoint sets it),
 * we return the Docker command; otherwise the native script command.
 */
export function getUpdateCommand(): string {
  if (process.env.CHILDCHECK_DOCKER) {
    return "docker compose pull && docker compose up -d";
  }
  return "sudo bash install/childcheck-update.sh";
}
