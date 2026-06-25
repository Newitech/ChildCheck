import { NextResponse, type NextRequest } from "next/server";

import { rateLimit } from "@/lib/rate-limit";

/**
 * Stage 16 — global rate-limiting middleware.
 *
 * Two limiters are applied here (single place so we don't have to wrap ~40
 * individual admin route handlers):
 *
 * 1. Login attempts — POST /api/auth/callback/credentials
 *    Limit: 10 / min / (username + IP).
 *    Blocks brute-force password guessing. The 11th attempt within a minute
 *    gets a 429 before NextAuth even hashes the password.
 *
 * 2. Admin writes — POST/PUT/PATCH/DELETE on /api/admin/*
 *    Limit: 60 / min / (session token + IP).
 *    Blocks a compromised admin session from hammering the API. We key on
 *    the NextAuth session cookie (which uniquely identifies the user's
 *    session) so different users get different buckets. Anonymous requests
 *    (no cookie) get the "anon" bucket — they'd be 401'd by the route
 *    handlers anyway.
 *
 * IMPORTANT: this limiter is in-memory (single-process). For multi-instance
 * deployments, swap in a Redis-backed limiter. See docs/deployment/security.md
 * §Rate limiting.
 *
 * Edge-runtime compatible — `rateLimit` uses only Map + Date.now().
 */

const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 60_000;

const ADMIN_WRITE_MAX = 60;
const ADMIN_WRITE_WINDOW_MS = 60_000;

const ADMIN_WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

function getSessionToken(req: NextRequest): string {
  return (
    req.cookies.get("next-auth.session-token")?.value ??
    req.cookies.get("__Secure-next-auth.session-token")?.value ??
    "anon"
  );
}

function rateLimitedResponse(retryAfterMs: number, label: string): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", label, retryAfterMs },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
        "X-RateLimit-Label": label,
      },
    },
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ip = getIp(req);
  const method = req.method.toUpperCase();

  // -----------------------------------------------------------------------
  // 1. Login attempts — POST /api/auth/callback/credentials
  // -----------------------------------------------------------------------
  if (
    pathname === "/api/auth/callback/credentials" &&
    method === "POST"
  ) {
    // Read the username from the request body so we can key on it. We clone
    // the request because the body can only be consumed once and downstream
    // NextAuth needs to read it too.
    let username = "";
    try {
      const cloned = req.clone();
      const body = (await cloned.json().catch(() => ({}))) as {
        username?: unknown;
      };
      if (typeof body.username === "string") {
        username = body.username.trim().toLowerCase();
      }
    } catch {
      // If we can't parse the body, just key on IP — NextAuth will reject
      // the malformed request itself.
    }
    const rlKey = `login:${username}:${ip}`;
    const rl = rateLimit(rlKey, LOGIN_MAX, LOGIN_WINDOW_MS);
    if (!rl.ok) {
      return rateLimitedResponse(rl.retryAfterMs, "login");
    }
    return NextResponse.next();
  }

  // -----------------------------------------------------------------------
  // 2. Admin writes — POST/PUT/PATCH/DELETE on /api/admin/*
  // -----------------------------------------------------------------------
  if (pathname.startsWith("/api/admin/") && ADMIN_WRITE_METHODS.has(method)) {
    const sessionToken = getSessionToken(req);
    const rlKey = `adminwrite:${sessionToken}:${ip}`;
    const rl = rateLimit(rlKey, ADMIN_WRITE_MAX, ADMIN_WRITE_WINDOW_MS);
    if (!rl.ok) {
      return rateLimitedResponse(rl.retryAfterMs, "admin_write");
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Only run middleware on the routes we rate-limit. Everything else
   * (pages, static, non-admin API, kiosk API) bypasses middleware entirely
   * for performance.
   */
  matcher: [
    "/api/auth/callback/credentials",
    "/api/admin/:path*",
  ],
};
