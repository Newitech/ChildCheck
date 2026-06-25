import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { verifyAuditChain } from "@/lib/audit-verify";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit/verify — verify the tamper-evident audit-log hash chain.
 *
 * Admin-only. Walks every AuditLog row from oldest→newest, recomputes each
 * row's SHA-256 hash, and flags the first row that fails (either its
 * recomputed hash doesn't match the stored hash — tampering — or its
 * prevHash doesn't match the prior row's hash — insertion/deletion).
 *
 * Returns:
 *   200 { ok: true, totalRows, verifiedRows, skippedUnhashed }
 *   200 { ok: false, brokenAt, reason, totalRows, verifiedRows, skippedUnhashed }
 *   401 { error: "unauthorized" }
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await verifyAuditChain();
  return NextResponse.json(result);
}
