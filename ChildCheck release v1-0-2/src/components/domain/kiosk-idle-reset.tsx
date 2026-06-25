"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";

/**
 * KioskIdleReset — resets the kiosk to the search screen after a configurable
 * period of inactivity.
 *
 * Behaviour:
 *   - Tracks mouse / touch / keyboard / scroll activity on window.
 *   - After `IDLE_MS` (default 90s) with no activity, shows a 10s warning
 *     toast ("Returning to search in 10s… tap to stay"). Tapping the toast
 *     (or any activity) dismisses it and resets the timer.
 *   - If the warning elapses with no interaction:
 *       - If we're on `/kiosk`, dispatch a `kiosk:reset` window event so the
 *         search screen can clear its input + results.
 *       - Otherwise, navigate to `/kiosk` (which forces a fresh search state
 *         via the route change).
 *   - All guards wrap `typeof window` so SSR is safe.
 *
 * The default 90s / 10s values are tuned for a public kiosk: long enough that
 * a slow family at the screen isn't bounced, short enough that an abandoned
 * screen returns to the privacy-safe search view before the next person.
 *
 * Stage 7+ may extend this to also clear any selected program / child
 * selection state.
 */

export const KIOSK_IDLE_MS = 90 * 1000; // 90s default idle reset for kiosk
const KIOSK_WARN_MS = 10 * 1000; // 10s warning before reset

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "touchend",
  "click",
  "scroll",
  "wheel",
];

export function KioskIdleReset({
  idleMs = KIOSK_IDLE_MS,
  warnMs = KIOSK_WARN_MS,
  redirectTo = "/kiosk",
}: {
  idleMs?: number;
  warnMs?: number;
  redirectTo?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const lastActivityRef = useRef<number>(Date.now());
  const warnShownRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mark = () => {
      lastActivityRef.current = Date.now();
      if (warnShownRef.current) {
        warnShownRef.current = false;
        toast.dismiss("kiosk-idle-warning");
      }
    };

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, mark, { passive: true }),
    );

    const tick = window.setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = idleMs - elapsed;
      if (remaining <= 0) {
        // Time's up — reset the kiosk.
        toast.dismiss("kiosk-idle-warning");
        warnShownRef.current = false;
        lastActivityRef.current = Date.now();

        if (pathname === redirectTo) {
          // Already on the search screen — ask it to clear its state.
          window.dispatchEvent(new CustomEvent("kiosk:reset"));
        } else {
          router.push(redirectTo);
        }
        return;
      }
      if (remaining <= warnMs && !warnShownRef.current) {
        warnShownRef.current = true;
        toast.warning(
          `Returning to search in ${Math.ceil(warnMs / 1000)}s… tap anywhere to stay.`,
          {
            id: "kiosk-idle-warning",
            duration: warnMs,
            onDismiss: () => {
              // Tapping the toast dismisses it → reset the idle timer.
              warnShownRef.current = false;
              lastActivityRef.current = Date.now();
            },
          },
        );
      }
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, mark));
      window.clearInterval(tick);
      toast.dismiss("kiosk-idle-warning");
    };
  }, [idleMs, warnMs, redirectTo, router, pathname]);

  return null;
}
