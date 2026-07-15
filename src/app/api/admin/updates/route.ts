import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import {
  checkForUpdate,
  getUpdateCommand,
  getVersion,
  type UpdateStatus,
} from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/updates — current version + the latest GitHub release +
 * whether an update is available + the appropriate update command for this
 * install type (Docker vs native).
 *
 * Auth: Admin only.
 *
 * Query params:
 *   force=1  — bypass the 1-hour in-memory cache (used by the "Check now"
 *              button in the admin UI).
 *
 * Response (200):
 *   {
 *     installedVersion: "1.0.0",
 *     latest?: {
 *       latestVersion, publishedAt, releaseNotes, htmlUrl, assets[]
 *     },
 *     updateAvailable: boolean,
 *     checkedAt: ISO,
 *     error?: string,         // present when the check failed OR is disabled
 *     disabled?: boolean,     // true when CHILDCHECK_UPDATE_REPO=off
 *     updateCommand: string,  // "docker compose pull ..." or "sudo bash ..."
 *     installType: "docker" | "native"
 *   }
 *
 * The checker is READ-ONLY: it fetches the public GitHub releases API and
 * never writes to the install. Applying an update is always external (see
 * docs/deployment/updating.md).
 *
 * Env vars:
 *   CHILDCHECK_UPDATE_REPO  e.g. "Newitech/ChildCheck" — defaults to the
 *                            public repo when unset; set to off/disabled/none/0
 *                            to disable checking.
 *   CHILDCHECK_DOCKER       set by the Docker entrypoint — controls which
 *                            update command is returned.
 */
export async function GET(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const status: UpdateStatus = await checkForUpdate({ force });
  const installType = process.env.CHILDCHECK_DOCKER ? "docker" : "native";

  return NextResponse.json({
    ...status,
    installedVersion: getVersion(),
    updateCommand: getUpdateCommand(),
    installType,
  });
}
