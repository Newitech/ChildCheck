"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * useRealtime — Socket.io client hook for the volunteer dashboard.
 *
 * Connects to the realtime mini-service via `io("/?XTransformPort=3003")`
 * (relative path + XTransformPort query — NEVER a direct localhost URL —
 * so Caddy can forward to the right port).
 *
 * Joins the given room (e.g. "room:abc123") and forwards these events to the
 * callback:
 *   - checkin:update
 *   - checkout:update
 *   - headcount:update
 *
 * Connection state is exposed via `connected` for UI hints (a small green/red
 * dot in the header). The dashboard MUST still work without realtime — the
 * caller is responsible for setting up a polling fallback (see
 * useVolunteerRoster in the dashboard client).
 *
 * On unmount, the socket is disconnected cleanly.
 */
export function useRealtime(
  room: string | null,
  onEvent: (event: string, payload: unknown) => void,
): { connected: boolean } {
  // socketConnected is ONLY updated from socket event callbacks (not in the
  // effect body) — this satisfies the react-hooks/set-state-in-effect rule.
  const [socketConnected, setSocketConnected] = useState(false);
  // Keep the latest callback in a ref so we don't have to tear down and
  // re-establish the socket every time the parent re-renders with a new
  // inline closure. The ref is updated inside an effect (NOT during render)
  // to satisfy the react-hooks/refs ESLint rule.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!room) {
      // No room to join — nothing to do. The derived `connected` value below
      // is false because `room` is null.
      return;
    }

    // Connect to the realtime mini-service via Caddy using XTransformPort.
    // NEVER use io("http://localhost:3003") — that would bypass the gateway
    // and fail in the sandbox preview.
    const socket: Socket = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10_000,
    });

    socket.on("connect", () => {
      setSocketConnected(true);
      // Join the requested room.
      socket.emit("join", room);
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
    });

    socket.on("connect_error", () => {
      setSocketConnected(false);
    });

    // Forward realtime events to the callback. The dashboard refetches the
    // roster / headcount history when these arrive.
    const forward = (payload: unknown) => {
      onEventRef.current("realtime-event", payload);
    };
    socket.on("checkin:update", forward);
    socket.on("checkout:update", forward);
    socket.on("headcount:update", forward);

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setSocketConnected(false);
    };
  }, [room]);

  // Derived: we're "connected" only if we have a room AND the socket reports
  // a live connection.
  const connected = useMemo(() => !!room && socketConnected, [room, socketConnected]);

  return { connected };
}
