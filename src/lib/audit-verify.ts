import { db } from "@/lib/db";
import { computeAuditHash } from "@/lib/audit";

/**
 * Tamper-evident audit-log chain verifier (Stage 16).
 *
 * Walks the AuditLog table from oldest→newest and, for each row that has a
 * `hash` (i.e. was written after the Stage 16 migration):
 *   - recomputes the row's hash from its fields and compares to the stored
 *     `hash` (detects in-place tampering with any field);
 *   - checks that the row's `prevHash` matches the previous verified row's
 *     `hash` (detects inserted or deleted rows in the middle of the chain).
 *
 * Rows written before the Stage 16 migration have null `hash` and are
 * skipped (counted as `skippedUnhashed`). The chain effectively starts at
 * the first row that has a hash.
 *
 * Returns `{ ok: true }` if every hashed row verifies, or
 * `{ ok: false, brokenAt: <id>, reason: <string> }` on the first failure.
 */

export interface AuditVerifyResult {
  ok: boolean;
  /** ID of the first row that failed verification (null when ok). */
  brokenAt?: string | null;
  /** Human-readable reason for the failure (null when ok). */
  reason?: string | null;
  /** Total rows scanned (hashed + unhashed). */
  totalRows: number;
  /** Hashed rows that verified successfully. */
  verifiedRows: number;
  /** Rows skipped because they predate the hash chain (null hash). */
  skippedUnhashed: number;
}

export async function verifyAuditChain(): Promise<AuditVerifyResult> {
  const rows = await db.auditLog.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      action: true,
      entity: true,
      entityId: true,
      details: true,
      ip: true,
      createdAt: true,
      prevHash: true,
      hash: true,
    },
  });

  let prevHash: string | null = null;
  let verified = 0;
  let skipped = 0;
  let chainStarted = false;

  for (const row of rows) {
    // Skip rows that predate the hash chain (no hash set).
    if (!row.hash) {
      skipped++;
      continue;
    }

    if (!chainStarted) {
      // First hashed row: accept whatever prevHash it has (it should be null
      // for the very first hashed row, but we don't fail on it — the chain
      // just starts here).
      chainStarted = true;
      prevHash = row.prevHash;
    } else {
      // Subsequent rows: prevHash must match the prior row's hash.
      if (row.prevHash !== prevHash) {
        return {
          ok: false,
          brokenAt: row.id,
          reason: `prevHash mismatch (expected ${prevHash?.slice(0, 12) ?? "null"}…, got ${row.prevHash?.slice(0, 12) ?? "null"}…) — row inserted or deleted`,
          totalRows: rows.length,
          verifiedRows: verified,
          skippedUnhashed: skipped,
        };
      }
    }

    // Recompute this row's hash and compare.
    const expected = computeAuditHash({
      id: row.id,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      details: row.details,
      ip: row.ip,
      createdAt: row.createdAt,
      prevHash: row.prevHash,
    });

    if (expected !== row.hash) {
      return {
        ok: false,
        brokenAt: row.id,
        reason: "hash mismatch (row tampered — recomputed hash does not match stored hash)",
        totalRows: rows.length,
        verifiedRows: verified,
        skippedUnhashed: skipped,
      };
    }

    prevHash = row.hash;
    verified++;
  }

  return {
    ok: true,
    brokenAt: null,
    reason: null,
    totalRows: rows.length,
    verifiedRows: verified,
    skippedUnhashed: skipped,
  };
}
