import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { computeAuditHash } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit — paginated, filterable audit-log viewer (Stage 16).
 *
 * Query params (all optional):
 *   page       — 1-based page number (default 1)
 *   pageSize   — rows per page, 1–200 (default 50)
 *   action     — exact action filter (e.g. "user.login")
 *   entity     — exact entity filter (e.g. "Person")
 *   entityId   — exact entityId filter
 *   actorUserId — exact actor filter
 *   dateFrom   — ISO date, rows with createdAt >= this
 *   dateTo     — ISO date, rows with createdAt <= this
 *   q          — free-text search on details JSON (case-insensitive LIKE)
 *
 * Returns:
 *   200 { items: AuditLogRow[], total, page, pageSize, totalPages }
 *   401 { error: "unauthorized" }
 *
 * Each item includes the row's `hash` (truncated for display) + a per-row
 * `tamperStatus` field that the UI renders as a badge:
 *   - "unhashed"   — pre-Stage-16 row (null hash), skipped by the verifier.
 *   - "ok"         — recomputed hash matches the stored hash.
 *   - "tampered"   — recomputed hash doesn't match (row was edited in-place).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sp = url.searchParams;

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(sp.get("pageSize") ?? "50", 10) || 50),
  );

  const action = sp.get("action")?.trim() || null;
  const entity = sp.get("entity")?.trim() || null;
  const entityId = sp.get("entityId")?.trim() || null;
  const actorUserId = sp.get("actorUserId")?.trim() || null;
  const dateFrom = sp.get("dateFrom")?.trim() || null;
  const dateTo = sp.get("dateTo")?.trim() || null;
  const q = sp.get("q")?.trim() || null;

  const where: {
    AND: Array<Record<string, unknown>>;
  } = { AND: [] };

  if (action) where.AND.push({ action });
  if (entity) where.AND.push({ entity });
  if (entityId) where.AND.push({ entityId });
  if (actorUserId) where.AND.push({ actorUserId });
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (!isNaN(d.getTime())) where.AND.push({ createdAt: { gte: d } });
  }
  if (dateTo) {
    const d = new Date(dateTo);
    if (!isNaN(d.getTime())) where.AND.push({ createdAt: { lte: d } });
  }
  if (q) {
    // SQLite LIKE is case-insensitive for ASCII.
    where.AND.push({ details: { contains: q } });
  }

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        actorUserId: true,
        action: true,
        entity: true,
        entityId: true,
        details: true,
        ip: true,
        createdAt: true,
        prevHash: true,
        hash: true,
      },
    }),
  ]);

  const items = rows.map((r) => {
    // Per-row tamper check: recompute the hash and compare to the stored one.
    let tamperStatus: "unhashed" | "ok" | "tampered" = "unhashed";
    if (r.hash) {
      const recomputed = computeAuditHash({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        details: r.details,
        ip: r.ip,
        createdAt: r.createdAt,
        prevHash: r.prevHash,
      });
      tamperStatus = recomputed === r.hash ? "ok" : "tampered";
    }

    // Look up actor name (best-effort, single query per page is fine — but
    // we have at most `pageSize` distinct actors, often much fewer).
    return {
      id: r.id,
      actorUserId: r.actorUserId,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      details: r.details,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
      prevHash: r.prevHash,
      hash: r.hash,
      hashShort: r.hash ? r.hash.slice(0, 12) : null,
      prevHashShort: r.prevHash ? r.prevHash.slice(0, 12) : null,
      tamperStatus,
    };
  });

  // Batch-resolve actor names so the UI can show them.
  const actorIds = Array.from(
    new Set(items.map((i) => i.actorUserId).filter((x): x is string => !!x)),
  );
  const actors =
    actorIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            username: true,
            person: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
  const actorMap = new Map(
    actors.map((a) => [
      a.id,
      {
        username: a.username,
        name: a.person ? `${a.person.firstName} ${a.person.lastName}` : a.username,
      },
    ]),
  );

  return NextResponse.json({
    items: items.map((i) => ({
      ...i,
      actor: i.actorUserId ? actorMap.get(i.actorUserId) ?? null : null,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
