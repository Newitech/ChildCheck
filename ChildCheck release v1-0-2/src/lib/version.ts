import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedVersion: string | null = null;

/** The installed ChildCheck version (from the VERSION file, cached). */
export function getVersion(): string {
  if (cachedVersion) return cachedVersion;
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
      /* try next */
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
  error?: string;
  disabled?: boolean;
}

let cachedStatus: UpdateStatus | null = null;
let cachedAt = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/** Compare semver versions: returns -1, 0, or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/** Get the appropriate update command for the current install type. */
export function getUpdateCommand(): string {
  if (process.env.CHILDCHECK_DOCKER === "true") {
    return "docker compose pull && docker compose up -d";
  }
  return "sudo bash install/childcheck-update.sh";
}

/**
 * Fetch the latest release from GitHub. The repo is configured via
 * CHILDCHETECK_UPDATE_REPO env var (e.g. "childcheck/childcheck").
 * If unset, returns a disabled state (no crash).
 */
export async function checkForUpdate(opts?: { force?: boolean }): Promise<UpdateStatus> {
  const installedVersion = getVersion();
  const now = new Date().toISOString();

  if (!opts?.force && cachedStatus && Date.now() - cachedAt < CACHE_TTL) {
    return cachedStatus;
  }

  const repo = process.env.CHILDCHECK_UPDATE_REPO;
  if (!repo) {
    const status: UpdateStatus = {
      installedVersion,
      updateAvailable: false,
      checkedAt: now,
      disabled: true,
      error: "CHILDCHETECK_UPDATE_REPO not set",
    };
    return status;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "ChildCheck" },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    if (!res.ok) {
      const status: UpdateStatus = {
        installedVersion,
        updateAvailable: false,
        checkedAt: now,
        error: `GitHub API returned ${res.status}`,
      };
      cachedStatus = status;
      cachedAt = Date.now();
      return status;
    }

    const data = (await res.json()) as {
      tag_name: string;
      published_at: string;
      body: string;
      html_url: string;
      assets: Array<{ name: string; browser_download_url: string; size: number }>;
    };

    const latestVersion = data.tag_name.replace(/^v/, "");
    const updateAvailable = compareVersions(installedVersion, latestVersion) < 0;

    const status: UpdateStatus = {
      installedVersion,
      latest: {
        latestVersion,
        publishedAt: data.published_at,
        releaseNotes: data.body ?? "",
        htmlUrl: data.html_url,
        assets: (data.assets ?? []).map((a) => ({
          name: a.name,
          downloadUrl: a.browser_download_url,
          size: a.size,
        })),
      },
      updateAvailable,
      checkedAt: now,
    };
    cachedStatus = status;
    cachedAt = Date.now();
    return status;
  } catch (err) {
    const status: UpdateStatus = {
      installedVersion,
      updateAvailable: false,
      checkedAt: now,
      error: err instanceof Error ? err.message : "Network error",
    };
    cachedStatus = status;
    cachedAt = Date.now();
    return status;
  }
}
