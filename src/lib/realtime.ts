/**
 * Realtime broadcast helper.
 *
 * Server-side (Next.js API routes only — never import from client code).
 * After a check-in/out / headcount mutation, call `broadcastRealtime(...)` to
 * notify the volunteer dashboard's open Socket.io connections.
 *
 * The broadcast goes through the realtime mini-service on port 3003 via an
 * internal HTTP POST /broadcast call (shared-secret header). The mini-service
 * then emits the event to every client that joined the relevant rooms.
 *
 * This is best-effort: if the mini-service is down, the dashboard falls back
 * to polling (see src/hooks/use-realtime.ts), so a failed broadcast MUST NOT
 * break the user's request.
 */

const REALTIME_URL =
  process.env.REALTIME_INTERNAL_URL ?? "http://127.0.0.1:3003";
const REALTIME_KEY =
  process.env.REALTIME_INTERNAL_KEY ?? "childcheck-internal-dev";

export type RealtimeEvent =
  | "checkin:update"
  | "checkout:update"
  | "headcount:update";

export interface BroadcastBody {
  event: RealtimeEvent;
  rooms: string[];
  payload: unknown;
}

/**
 * Compute the set of "rooms" (Socket.io channel names) that should be notified
 * for a given scope. Pass any of roomId / classId / programId that are known.
 * Returns at least the granular room-level channel for each non-null value.
 */
export function roomsForScope(scope: {
  roomId?: string | null;
  classId?: string | null;
  programId?: string | null;
  checkInSessionId?: string | null;
}): string[] {
  const rooms = new Set<string>();
  if (scope.roomId) rooms.add(`room:${scope.roomId}`);
  if (scope.classId) rooms.add(`class:${scope.classId}`);
  if (scope.programId) rooms.add(`program:${scope.programId}`);
  if (scope.checkInSessionId) rooms.add(`session:${scope.checkInSessionId}`);
  return Array.from(rooms);
}

/**
 * POST an event to the realtime mini-service's /broadcast endpoint.
 * Best-effort: never throws. Returns true on success, false on failure.
 */
export async function broadcastRealtime(
  body: BroadcastBody,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${REALTIME_URL}/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": REALTIME_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch (err) {
    // Swallow — realtime is best-effort. Log to stderr for debugging.
    console.error("[realtime] broadcast failed:", err);
    return false;
  }
}
