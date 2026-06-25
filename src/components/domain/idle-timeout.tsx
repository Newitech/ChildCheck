"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";

/**
 * Lightweight idle-timeout.
 *
 * - 15 minutes of inactivity (no mouse/keyboard/touch/scroll events) →
 *   show a 60-second warning toast, then call signOut({ callbackUrl:
 *   "/login?reason=idle" }).
 * - Any activity resets both the idle timer and the warning toast.
 *
 * Mounted inside the admin & volunteer layouts only — kiosk has its own
 * (Stage 6) idle-reset behaviour.
 */

const IDLE_MS = 15 * 60 * 1000; // 15 minutes
const WARN_MS = 60 * 1000; // 60s warning

export function IdleTimeout() {
  const lastActivityRef = useRef<number>(Date.now());
  const warnShownRef = useRef<boolean>(false);
  const [, force] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "touchend",
      "click",
      "scroll",
      "wheel",
    ];

    const mark = () => {
      lastActivityRef.current = Date.now();
      if (warnShownRef.current) {
        warnShownRef.current = false;
        toast.dismiss("idle-warning");
      }
    };

    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));

    const interval = window.setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = IDLE_MS - elapsed;
      if (remaining <= 0) {
        // Time's up — sign out.
        toast.dismiss("idle-warning");
        toast.info("You've been signed out due to inactivity.", {
          id: "idle-signout",
        });
        void signOut({ callbackUrl: "/login?reason=idle" });
        return;
      }
      if (remaining <= WARN_MS && !warnShownRef.current) {
        warnShownRef.current = true;
        toast.warning(
          "You'll be signed out in 60 seconds due to inactivity. Click anywhere to stay signed in.",
          { id: "idle-warning", duration: WARN_MS },
        );
      }
      // Nudge re-render every tick so the warning state can flip if needed.
      force((n) => n + 1);
    }, 5000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      window.clearInterval(interval);
      toast.dismiss("idle-warning");
    };
  }, []);

  return null;
}
