"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { WifiOff, RefreshCw, CheckCircle2, CloudUpload } from "lucide-react";

/**
 * OfflineIndicator — listens to online/offline + service-worker queue
 * messages, and shows a small status banner.
 *
 * Banner states (priority high → low):
 *   1. "Syncing N queued check-ins..." (queue:replaying)
 *   2. "Offline — check-ins are queued and will sync when reconnected."
 *   3. "All synced ✓" (queue:synced) — shown briefly (3s) then dismissed.
 *
 * The banner is sticky (top of the kiosk viewport). It's intentionally tiny
 * and unobtrusive so it doesn't crowd the kiosk UI.
 *
 * If the service worker is not registered (dev mode), this component still
 * works — it just shows the browser's native online/offline state.
 */

// useSyncExternalStore wiring for navigator.onLine.
function subscribeOnline(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
function getOnlineSnapshot() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}
function getOnlineServerSnapshot() {
  return true;
}

export function OfflineIndicator() {
  const online = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getOnlineServerSnapshot,
  );
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncCount, setSyncCount] = useState<number>(0);
  const [allSynced, setAllSynced] = useState<boolean>(false);

  useEffect(() => {
    const onOnline = () => {
      setAllSynced(false);
      // Ask the SW how many are queued (if it's around).
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "queue:count" });
      }
    };
    const onOffline = () => {
      setAllSynced(false);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // SW queue messages.
    const onMessage = (event: MessageEvent) => {
      const data = event.data || {};
      switch (data.type) {
        case "queue:added":
          setSyncCount((n) => n + 1);
          setAllSynced(false);
          break;
        case "queue:replaying":
          setSyncing(true);
          setSyncCount(typeof data.count === "number" ? data.count : 0);
          break;
        case "queue:synced":
          setSyncing(false);
          setSyncCount(0);
          setAllSynced(true);
          // Auto-dismiss the "All synced" banner after 3s.
          window.setTimeout(() => setAllSynced(false), 3000);
          break;
        case "queue:partial":
          setSyncing(false);
          setSyncCount(typeof data.remaining === "number" ? data.remaining : 0);
          setAllSynced(true);
          window.setTimeout(() => setAllSynced(false), 3000);
          break;
        case "queue:item-failed":
          // A queued item permanently failed (4xx). Show a brief "synced"
          // (the queue size just dropped) and let the UI continue.
          break;
        case "queue:count:response":
          setSyncCount(typeof data.count === "number" ? data.count : 0);
          break;
        case "queue:ready":
          // SW activated — ask for current count.
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: "queue:count" });
          }
          break;
      }
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onMessage);
      // Ask the SW for the current queue size on mount.
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "queue:count" });
      }
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onMessage);
      }
    };
  }, []);

  // Don't render anything when online + nothing queued + not syncing + not just synced.
  if (online && !syncing && syncCount === 0 && !allSynced) {
    return null;
  }

  let icon = <WifiOff className="h-4 w-4 shrink-0" />;
  let message = "Offline — check-ins are queued and will sync when reconnected.";
  let tone = "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/80 dark:text-amber-100 dark:border-amber-800";

  if (syncing) {
    icon = <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />;
    message = `Syncing ${syncCount} queued check-in${syncCount === 1 ? "" : "s"}...`;
    tone = "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950/80 dark:text-blue-100 dark:border-blue-800";
  } else if (online && syncCount > 0) {
    icon = <CloudUpload className="h-4 w-4 shrink-0" />;
    message = `${syncCount} check-in${syncCount === 1 ? "" : "s"} queued — will sync shortly.`;
    tone = "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/80 dark:text-amber-100 dark:border-amber-800";
  } else if (allSynced) {
    icon = <CheckCircle2 className="h-4 w-4 shrink-0" />;
    message = "All synced ✓";
    tone = "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-100 dark:border-emerald-800";
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full border-b px-4 py-2 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 ${tone}`}
    >
      {icon}
      <span>{message}</span>
    </div>
  );
}
