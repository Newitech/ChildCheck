/**
 * In-memory rate limiter for ChildCheck (Stage 6 + Stage 16).
 *
 * Two APIs are exposed:
 *
 * 1. `rateLimit(key, max, windowMs)` — generic sliding-window limiter used by
 *    the Stage 16 middleware (login + admin writes) and the refactored
 *    kiosk search + guardian PIN routes. Sliding window: stores the list of
 *    recent request timestamps per key, prunes anything older than `windowMs`,
 *    and admits the request iff the pruned list has fewer than `max` entries.
 *
 * 2. `createRateLimiter(opts)` — Stage 6 fixed-window limiter, kept for
 *    backward compat. Internally delegates to `rateLimit`.
 *
 * 3. `withRateLimit(handler, opts)` — wraps a Next.js route handler with
 *    rate limiting. `opts.keyFn(req)` derives the bucket key (default: client
 *    IP).
 *
 * IMPORTANT: this limiter lives in process memory — it is NOT shared across
 * instances. For multi-instance / horizontal-scaled deployments, swap in a
 * Redis-backed limiter (e.g. `@upstash/ratelimit` or a custom Lua script on
 * Redis INCR + EXPIRE). The in-memory limiter is fine for the single-process
 * kiosk/admin deployment ChildCheck is designed for.
 *
 * Edge-runtime compatible: uses only `Map`, `Date.now()`, and `Math` — no
 * `setInterval` or Node-specific APIs. This lets it run inside `middleware.ts`.
 */

export interface RateLimitResult {
  /** Whether the request is allowed. */
  ok: boolean;
  /** ms until the limiter would admit another request (0 if ok). */
  retryAfterMs: number;
  /** How many more requests are allowed in the current window (0 if denied). */
  remaining: number;
}

// ---------------------------------------------------------------------------
// Sliding-window limiter (Stage 16)
// ---------------------------------------------------------------------------

/** Map of key → array of admitted request timestamps (ms since epoch). */
const slidingBuckets = new Map<string, number[]>();

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
let lastSweepAt = 0;

/**
 * Prune stale entries from the map. Called lazily on every `rateLimit` check;
 * the actual sweep runs at most once per SWEEP_INTERVAL_MS.
 */
function maybeSweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  // Use a generous 10-minute cutoff so we don't accidentally drop still-active
  // windows (the largest window we use is 1 min; 10 min is safe headroom).
  const cutoff = now - 10 * 60 * 1000;
  for (const [k, arr] of slidingBuckets) {
    const fresh = arr.filter((t) => t > cutoff);
    if (fresh.length === 0) {
      slidingBuckets.delete(k);
    } else {
      slidingBuckets.set(k, fresh);
    }
  }
}

/**
 * Sliding-window rate limit check.
 *
 * @param key      Bucket key (e.g. "login:admin:1.2.3.4" or "adminwrite:<token>").
 * @param max      Max requests admitted in any rolling `windowMs` window.
 * @param windowMs Window size in ms.
 * @returns {@link RateLimitResult} — call sites should return 429 when `!ok`.
 */
export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  maybeSweep(now);

  const cutoff = now - windowMs;
  const arr = slidingBuckets.get(key) ?? [];
  // Prune timestamps older than the window.
  const fresh = arr.filter((t) => t > cutoff);

  if (fresh.length >= max) {
    // Denied: retryAfter = oldest timestamp + window - now.
    const oldest = fresh[0] ?? now;
    const retryAfterMs = Math.max(1, oldest + windowMs - now);
    slidingBuckets.set(key, fresh);
    return { ok: false, retryAfterMs, remaining: 0 };
  }

  fresh.push(now);
  slidingBuckets.set(key, fresh);
  return {
    ok: true,
    retryAfterMs: 0,
    remaining: Math.max(0, max - fresh.length),
  };
}

// ---------------------------------------------------------------------------
// withRateLimit helper (Stage 16) — wraps a Next.js route handler.
// ---------------------------------------------------------------------------

export interface WithRateLimitOptions {
  /** Max requests admitted per window. */
  max: number;
  /** Window size in ms. */
  windowMs: number;
  /** Derive the bucket key from the request (default: client IP). */
  keyFn?: (req: Request) => string;
  /**
   * Optional human-readable label for the limiter (used in the 429 body).
   * Defaults to "rate_limited".
   */
  label?: string;
}

/**
 * Wrap a Next.js API route handler with rate limiting.
 *
 * Example:
 * ```ts
 * export const POST = withRateLimit(handlePost, {
 *   max: 60, windowMs: 60_000,
 *   keyFn: (req) => `myroute:${getClientIp(req)}`,
 * });
 * ```
 */
export function withRateLimit<TArgs extends unknown[]>(
  handler: (req: Request, ...args: TArgs) => Promise<Response> | Response,
  opts: WithRateLimitOptions,
): (req: Request, ...args: TArgs) => Promise<Response> {
  return async (req: Request, ...args: TArgs): Promise<Response> => {
    const key = opts.keyFn ? opts.keyFn(req) : `default:${getClientIp(req)}`;
    const rl = rateLimit(key, opts.max, opts.windowMs);
    if (!rl.ok) {
      const body: Record<string, unknown> = {
        error: opts.label ?? "rate_limited",
        retryAfterMs: rl.retryAfterMs,
      };
      return new Response(JSON.stringify(body), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      });
    }
    return handler(req, ...args);
  };
}

// ---------------------------------------------------------------------------
// Legacy fixed-window createRateLimiter (Stage 6) — kept for backward compat.
// Internally delegates to the sliding-window `rateLimit` so there's a single
// source of truth. New code should use `rateLimit` / `withRateLimit` directly.
// ---------------------------------------------------------------------------

export interface RateLimiterOptions {
  /** Window size in ms. Default 60_000 (1 minute). */
  windowMs?: number;
  /** Max requests per window. Default 30. */
  max?: number;
}

export interface RateLimiterResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Requests counted in the current window (including this one if allowed). */
  count: number;
  /** Max requests allowed in the window. */
  max: number;
  /** ms until the window resets (and the limiter would accept again). */
  retryAfterMs: number;
}

/**
 * Returns a rate-limiter object bound to a single bucket namespace. Use one
 * limiter instance per protected route. Deprecated: prefer `rateLimit` /
 * `withRateLimit` for new code.
 */
export function createRateLimiter(opts: RateLimiterOptions = {}): {
  check: (key: string) => RateLimiterResult;
} {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 30;

  return {
    check(key: string): RateLimiterResult {
      const rl = rateLimit(key, max, windowMs);
      // Approximate count: max - remaining (when allowed) or max (when denied).
      const count = rl.ok ? max - rl.remaining : max;
      return {
        allowed: rl.ok,
        count,
        max,
        retryAfterMs: rl.retryAfterMs,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Client-IP extraction
// ---------------------------------------------------------------------------

/**
 * Extract a best-effort client IP from a Request. Falls back to "unknown"
 * which means all anonymous requests share a single bucket — fine for
 * /api/kiosk/search since anonymous access only happens in open mode and
 * the limit is generous.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // First IP in the list is the original client.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}
