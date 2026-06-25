import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { scheduledBackupIfDue } from "@/lib/backup";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/backup/tick
 *
 * Lightweight scheduled-backup check. Idempotent. Safe to call from a cron
 * job, a browser tab on /admin/backup, or any admin page load.
 *
 * Behaviour:
 *   - If `scheduled_backups` flag is OFF → no-op (returns { created: false }).
 *   - If flag is ON and the most recent .cbak is older than 24h (or there
 *     are none) → create one. Returns { created: true, filename }.
 *   - Cooldown: at most one check per minute (process-wide).
 *
 * Production: prefer a real scheduler (systemd timer / Windows Task Scheduler)
 * hitting this endpoint at the desired interval. Example cron (daily 02:00):
 *
 *   0 2 * * *  curl -fsS -X POST \
 *       -H "Cookie: next-auth.session-token=<...>" \
 *       http://localhost:3000/api/admin/backup/tick
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await scheduledBackupIfDue(user.id);
  return NextResponse.json(result);
}
