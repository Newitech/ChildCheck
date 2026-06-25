import { db } from "@/lib/db";
import { getOrgConfig } from "@/lib/branding";
import { webcrypto } from "node:crypto";

/**
 * Stage 7 — Daily check-out code (per family per calendar day).
 *
 * Semantics (from Stage 7 spec + user enhancement):
 *   - One code per family per calendar day.
 *   - Generated on the FIRST check-in of the day for that family.
 *   - Idempotent: once generated, the SAME code is returned for every subsequent
 *     read/write that same day — including reads by other carers / guardians
 *     of the family signing in with their own PIN. Stage 8 (check-out) accepts
 *     this code for fast sign-out.
 *   - Generated REGARDLESS of the `guardian_pin_signin` flag — the code always
 *     exists once the first check-in of the day happens.
 *
 * Character set + length (user-requested enhancement for brute-force resistance):
 *   - Default charset: ALPHANUMERIC — uppercase letters A-Z minus confusing
 *     chars (O, I, L) + digits 2-9 (no 0/1). This gives ~31 chars, so a 3-char
 *     code has ~29,791 possibilities vs 1,000 for numeric-only — ~30x harder
 *     to brute-force. Admins can switch to "numeric" (0-9) if preferred.
 *   - Default length: 3. Configurable by admin (Organisation.dailyCodeLength),
 *     recommended 3–6. Longer = exponentially harder to brute-force.
 *   - Existing numeric codes (e.g. "417") remain valid until they age out —
 *     checkout compares strings, so mixed historical codes work fine.
 *
 * Implementation notes:
 *   - `codeDate` is stored as MIDNIGHT UTC of the calendar date. SQLite doesn't
 *     honour `@db.Date` (Prisma stores it as DateTime anyway), so to keep
 *     "calendar day" comparisons stable across time zones we always normalise
 *     via `startOfDayUTC(date)` before read/write.
 *   - We use `db.dailyCode.upsert` against the `@@unique([familyId, codeDate])`
 *     index, so concurrent first-check-ins for the same family will produce a
 *     single code (one writer wins, the other reads the existing row).
 *   - Collisions across families on the same day are fine — the code is unique
 *     PER FAMILY, not globally. Stage 8 check-out looks up by
 *     (familyId, code, codeDate) — no ambiguity.
 */

/**
 * Alphanumeric alphabet with ambiguous characters removed:
 * no O (looks like 0), no I/L (look like 1), no 0, no 1. 31 chars total.
 */
const ALPHANUMERIC_SAFE = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const NUMERIC = "0123456789";

/** Midnight UTC of the given date — the canonical "codeDate" we store. */
export function startOfDayUTC(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/**
 * Generate a fresh code using the org's configured charset + length.
 * Uses crypto.getRandomValues for cryptographically-strong randomness
 * (better than Math.random for a security-relevant code).
 */
function generateCode(
  length: number = 3,
  charset: "alphanumeric" | "numeric" = "alphanumeric",
): string {
  const alphabet = charset === "numeric" ? NUMERIC : ALPHANUMERIC_SAFE;
  const len = Math.max(2, Math.min(10, length)); // clamp 2–10
  // Use Web Crypto (node:crypto.webcrypto) for cryptographically-strong randomness.
  const randomValues = new Uint8Array(len);
  try {
    webcrypto.getRandomValues(randomValues);
  } catch {
    // Extremely unlikely fallback — keeps generation working even if webcrypto unavailable.
    for (let i = 0; i < len; i++) randomValues[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[randomValues[i] % alphabet.length];
  }
  return out;
}

/**
 * Get-or-create the daily code for a family on a given date.
 * Idempotent: if a DailyCode row exists for (familyId, date), return it;
 * otherwise generate a new code using the org's configured charset + length
 * (default alphanumeric, length 3) and create the row.
 */
export async function getOrCreateDailyCode(
  familyId: string,
  date: Date,
): Promise<string> {
  const codeDate = startOfDayUTC(date);
  // Read the org's code config (cached in getOrgConfig).
  const config = await getOrgConfig();
  // Upsert against the @@unique([familyId, codeDate]) index. Two concurrent
  // first-check-ins for the same family will both resolve to the same row —
  // one creates, the other's update is a no-op (we don't change `code`).
  const row = await db.dailyCode.upsert({
    where: { familyId_codeDate: { familyId, codeDate } },
    create: {
      familyId,
      codeDate,
      code: generateCode(config.dailyCodeLength, config.dailyCodeCharset),
    },
    update: {}, // never overwrite an existing code
    select: { code: true },
  });
  return row.code;
}

/** Read the existing daily code for a family+date (null if none yet). */
export async function getDailyCode(
  familyId: string,
  date: Date,
): Promise<string | null> {
  const codeDate = startOfDayUTC(date);
  const row = await db.dailyCode.findUnique({
    where: { familyId_codeDate: { familyId, codeDate } },
    select: { code: true },
  });
  return row?.code ?? null;
}
