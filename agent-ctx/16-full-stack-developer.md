# Task 16 — Stage 16 — Security hardening & audit

## Context
- Project: ChildCheck (Next.js 16, App Router, TS strict, Tailwind 4, shadcn/ui, Prisma + SQLite).
- Dev server on port 3000 (auto-run by system — DO NOT run `bun run dev`).
- Test admin: username `admin`, password `password123`.
- DB client: `import { db } from "@/lib/db"` (Prisma).
- Crypto: `src/lib/crypto.ts` — AES-256-GCM, master key = `process.env.CHILDCHECK_DATA_KEY || "0".repeat(64)` (well, in dev a stable seed).
- AuditLog model exists from Stage 1 (fields: id, actorUserId, action, entity, entityId, details, ip, createdAt). Stage 16 adds prevHash + hash.
- Existing audit helper: `src/lib/audit.ts` `logAudit(entry)`.
- Existing rate limiter: `src/lib/rate-limit.ts` has `createRateLimiter({max, windowMs})` (fixed-window) + `getClientIp(req)`. Used by `/api/kiosk/search` (30/min/IP) and `/api/kiosk/guardian-signin` (5/min/family).
- Existing auth: `src/lib/auth.ts` — NextAuth v4 credentials provider, `requireRole`, `requirePermission`, role-permission matrix.
- Existing feature flag: `audit_log_detailed`.

## Plan

### A. Tamper-evident audit log
1. Edit `prisma/schema.prisma` — add `prevHash String?` + `hash String?` to AuditLog; add `@@index([createdAt])` for the viewer.
2. Bump db.ts cache key v3 → v4 (force fresh PrismaClient after schema change).
3. `bun run db:push` — sync the new columns.
4. Edit `src/lib/audit.ts`:
   - Add `computeAuditHash(row)` exported function — sha256 of `id|action|entity|entityId|details|ip|createdAt(ISO)|prevHash`.
   - Update `logAudit` to: insert row → read previous row's hash → compute this row's hash → patch row. Wrap in `db.$transaction` for atomicity + serialization on the chain.
5. Create `src/lib/audit-verify.ts`:
   - `verifyAuditChain(): Promise<{ ok, brokenAt?, reason?, totalRows, verifiedRows, skippedUnhashed }>`.
   - Walk rows oldest→newest, skip null-hash rows (pre-Stage-16), check `prevHash` matches prior row's `hash`, recompute `hash` and compare. Return first failure or `{ ok: true }`.
6. Create `GET /api/admin/audit/verify/route.ts` — Admin-only, runs verifyAuditChain, returns JSON.
7. Create `GET /api/admin/audit/route.ts` — Admin-only, paginated with filters (page, pageSize, action, entity, entityId, actorUserId, dateFrom, dateTo, q). Returns items with hash + per-row tamperStatus ("unhashed" / "ok" / "tampered") + actor name lookup.
8. Create `/admin/audit/page.tsx` — server component, Admin-only, redirects non-admins.
9. Create `/admin/audit/audit-viewer.tsx` — client component. Filters card + Verify button (green/red banner) + paginated table with tamper badges + hash shortcodes.

### B. General rate limiting
1. Edit `src/lib/rate-limit.ts`:
   - Add `rateLimit(key, max, windowMs)` — sliding-window (Map<key, timestamps[]> with lazy TTL cleanup). Edge-runtime compatible (no setInterval). Returns `{ ok, retryAfterMs, remaining }`.
   - Add `withRateLimit(handler, opts)` helper for per-route use.
   - Keep existing `createRateLimiter` for backward compat (delegates to `rateLimit` internally).
2. Create `src/middleware.ts` — intercepts:
   - `POST /api/auth/callback/credentials` → 10/min/username+IP (login brute-force protection). Parses body to extract username, clones request so NextAuth can still read it.
   - `POST/PUT/PATCH/DELETE /api/admin/*` → 60/min/sessionToken+IP (compromised-session protection). Reads session token from cookie.
   - Returns 429 with `{ error: "rate_limited", label, retryAfterMs }` + `Retry-After` header.
3. Refactor `/api/kiosk/search` + `/api/kiosk/guardian-signin` to use `rateLimit` instead of `createRateLimiter`.
4. Update `/login/login-form.tsx` to surface 429 as a "Too many sign-in attempts" message.

### C. Security hardening guide
- Create `docs/deployment/security.md` — firewall (LAN-only mode), TLS (Caddy + Nginx samples), service user, file permissions, encryption-at-rest (CHILDCHECK_DATA_KEY), master-key rotation procedure, session security (NextAuth cookies), rate limiting, audit log, backup security, child data minimization, LAN-only mode, security checklist, incident response.

### D. LAN-only mode
- Documented in security.md §1 + §11. No code change (the app already doesn't make outbound calls; `email_recovery` is OFF by default).

### E. Key rotation script
- Create `scripts/rotate-key.ts`:
  - Reads `CHILDCHECK_DATA_KEY_OLD` + `CHILDCHECK_DATA_KEY` from env (validates 32 bytes each, refuses if identical).
  - Iterates all Person rows with photoPath, decrypts each photo with old key, re-encrypts with new key.
  - Iterates branding dir for `logo.*` files — attempts decryption, skips gracefully if not encrypted (current state: branding logo is a plain public-asset file).
  - Does NOT touch backups (documented — old backups need the old key to restore).
  - Writes AuditLog entry `key.rotation` with computed hash (part of the chain).
  - Prints summary + next-steps instructions.

### F. Admin home card
- Add "Audit log" card to the SECTIONS grid in `/admin/page.tsx` (icon: Fingerprint).
- Add "Audit" button to the quick-links row.

## Non-negotiables
- TS strict-friendly, no `any`.
- Every mutation is an API route (the audit log viewer is GET-only — fine).
- Sticky footer (admin layout already has it).
- `bun run lint` clean.
- Don't break prior stages.
- Hash chain deterministic — sha256 via node:crypto.
- Existing pre-Stage-16 audit rows have null hashes — verifier skips them.
- Rate limiter is in-memory (single-process) — documented in security.md.

## Self-verification (planned)
1. `bun run lint` clean.
2. `bun run db:push` ok (AuditLog has prevHash + hash).
3. Trigger an audit-write action (update a feature flag) → check new AuditLog row has non-null hash.
4. `GET /api/admin/audit/verify` → `{ ok: true }`.
5. `/admin/audit` renders with filters + Verify button.
6. Click Verify → "Chain intact ✓".
7. Tamper test: directly UPDATE an AuditLog row's `details` in SQLite → verify endpoint returns `{ ok: false, brokenAt: <id> }` + UI shows red.
8. Rate limit: 11 rapid login attempts with wrong password → 11th returns 429.
9. `docs/deployment/security.md` exists with the checklist.
10. `scripts/rotate-key.ts` exists.
11. `/admin/audit` logged-out → redirect.
12. dev.log no errors.
13. Screenshots: `/tmp/s16-audit.png`, `/tmp/s16-verify.png`, `/tmp/s16-tamper.png`.
