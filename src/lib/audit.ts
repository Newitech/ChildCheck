import crypto from "node:crypto";

import { db } from "@/lib/db";

/**
 * Append-only, tamper-evident audit log helper (Stage 16).
 *
 * Stage 16 adds a SHA-256 hash chain to the AuditLog table:
 *   - `prevHash` = the `hash` of the immediately preceding AuditLog row
 *     (null for the first row in the chain).
 *   - `hash`     = sha256( id | action | entity | entityId | details | ip
 *                            | createdAt(ISO) | prevHash ).
 *
 * Verification (src/lib/audit-verify.ts) walks the chain oldest→newest and
 * flags any row whose recomputed hash doesn't match the stored value
 * (tampered) or whose prevHash doesn't match the prior row's hash
 * (inserted/deleted).
 *
 * Rows written before the Stage 16 migration have null `prevHash` + `hash`
 * and are skipped by the verifier (with a `skippedUnhashed` count). The
 * chain effectively starts from the first row that has a hash.
 *
 * Audit writes MUST be best-effort — they should never break a user request.
 * Always wrap callers in their own try/catch if they care; this helper
 * swallows internal errors and logs to stderr.
 */

export interface AuditEntry {
  actorUserId?: string | null;
  /// The Person who performed the action when the actor is a guardian (a Person,
  /// not a User). Set for guardian self-service portal actions; null otherwise.
  actorPersonId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | string | null;
  ip?: string | null;
}

export interface AuditLogRowForHash {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: string | null;
  ip: string | null;
  createdAt: Date;
  prevHash: string | null;
}

/**
 * Compute the SHA-256 hash of an audit log row, using the deterministic
 * concatenation: id|action|entity|entityId|details|ip|createdAt(ISO)|prevHash.
 *
 * Pipe-separated to avoid ambiguity (none of the fields may contain a literal
 * pipe that could collide — and even if they did, the collision would have to
 * also reproduce the exact byte layout, which is computationally infeasible).
 * createdAt is rendered as ISO-8601 UTC for cross-timezone stability.
 */
export function computeAuditHash(row: AuditLogRowForHash): string {
  const parts = [
    row.id,
    row.action,
    row.entity ?? "",
    row.entityId ?? "",
    row.details ?? "",
    row.ip ?? "",
    row.createdAt.toISOString(),
    row.prevHash ?? "",
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const details =
      typeof entry.details === "string"
        ? entry.details
        : entry.details
          ? JSON.stringify(entry.details)
          : null;

    // Compute the hash chain inside a transaction so concurrent writes
    // serialize on the "find last hash → insert" sequence. SQLite has a
    // single-writer model so $transaction with sequential reads+writes
    // gives us the integrity we need without an explicit lock.
    await db.$transaction(async (tx) => {
      // 1. Insert the row first (let Prisma generate id + createdAt), with
      //    null prevHash/hash. We'll patch them in the next step.
      const created = await tx.auditLog.create({
        data: {
          actorUserId: entry.actorUserId ?? null,
          actorPersonId: entry.actorPersonId ?? null,
          action: entry.action,
          entity: entry.entity ?? null,
          entityId: entry.entityId ?? null,
          details,
          ip: entry.ip ?? null,
        },
      });

      // 2. Read the immediately-preceding row's hash. We exclude the just-
      //    inserted row and order by createdAt desc — which gives us the
      //    row that was "last" right before our insert.
      const prev = await tx.auditLog.findFirst({
        where: { id: { not: created.id } },
        orderBy: { createdAt: "desc" },
        select: { hash: true },
      });
      const prevHash = prev?.hash ?? null;

      // 3. Compute this row's hash.
      const hash = computeAuditHash({
        id: created.id,
        action: created.action,
        entity: created.entity,
        entityId: created.entityId,
        details: created.details,
        ip: created.ip,
        createdAt: created.createdAt,
        prevHash,
      });

      // 4. Patch the row with prevHash + hash.
      await tx.auditLog.update({
        where: { id: created.id },
        data: { prevHash, hash },
      });
    });
  } catch (err) {
    // Never throw on audit failure.
    console.error("[audit] failed to write audit log:", err);
  }
}
