"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Download, X, Share, Plus, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * InstallPrompt — listens for `beforeinstallprompt` (Chromium) and shows an
 * "Install ChildCheck as an app" banner. On iOS Safari (no BIP event), shows
 * a small "Add to Home Screen" tip instead.
 *
 * Dismissible: stores `childcheck-install-dismissed-at` in localStorage with
 * a 30-day cooldown — re-shows after that window if still installable.
 *
 * Use:
 *   - Mount on the home page (top-of-content banner).
 *   - Mount in the kiosk layout (smaller, top banner).
 *
 * Notes:
 *   - In dev (NODE_ENV !== "production") the BIP event may still fire on
 *     Chrome but the SW isn't registered, so the browser may not consider the
 *     app installable. That's expected — the iOS tip still shows on iOS.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "childcheck-install-dismissed-at";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days.

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports as Mac, so check for touch + Mac.
  const isIPad =
    /iPad/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  const isIPhone = /iPhone|iPod/.test(ua);
  return isIPad || isIPhone;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari standalone.
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS-specific.
  if ("standalone" in window.navigator && window.navigator.standalone === true) {
    return true;
  }
  return false;
}

function isDismissed(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at)) return false;
  return Date.now() - at < DISMISS_TTL_MS;
}

function dismissNow() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
}

/**
 * useMounted — returns false during SSR and the initial hydration render,
 * true afterwards. Used to safely read browser-only APIs (localStorage,
 * matchMedia, navigator.userAgent) without triggering hydration mismatches.
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export function InstallPrompt({ variant = "banner" }: { variant?: "banner" | "compact" }) {
  const mounted = useMounted();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  // `userDismissed` is set only when the user clicks the X — independent of
  // the localStorage-based 30-day cooldown (which is also written).
  const [userDismissed, setUserDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (!mounted) return;

    const onBIP = (event: Event) => {
      // Prevent the mini-infobar from showing on mobile Chrome.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setUserDismissed(true);
    };

    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [mounted]);

  if (!mounted || userDismissed) return null;

  // Browser-only checks (safe now — mounted === true).
  const installed = isStandalone();
  const dismissed = isDismissed();
  const ios = detectIOS();

  if (installed || dismissed) return null;

  // Chromium + BIP fired.
  if (deferred) {
    const onInstall = async () => {
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === "accepted") {
          setUserDismissed(true);
        } else {
          // User dismissed the native prompt — dismiss our banner too.
          dismissNow();
          setUserDismissed(true);
        }
      } catch {
        /* swallow */
      }
    };
    return renderBanner({
      variant,
      icon: <Download className="h-4 w-4 shrink-0" />,
      title: "Install ChildCheck as an app",
      body: "Works offline, opens full-screen, and lives on your Home Screen.",
      actionLabel: "Install",
      onAction: onInstall,
      onDismiss: () => {
        dismissNow();
        setUserDismissed(true);
      },
    });
  }

  // iOS Safari — no BIP. Show the "Add to Home Screen" tip.
  if (ios) {
    return renderBanner({
      variant,
      icon: <Smartphone className="h-4 w-4 shrink-0" />,
      title: "Add ChildCheck to your Home Screen",
      body: (
        <>
          Tap <Share className="inline h-3 w-3 align-text-bottom" /> in Safari, then{" "}
          <Plus className="inline h-3 w-3 align-text-bottom" /> &ldquo;Add to Home Screen&rdquo;.
        </>
      ),
      actionLabel: "More help",
      actionHref: "/install",
      onDismiss: () => {
        dismissNow();
        setUserDismissed(true);
      },
    });
  }

  // Desktop browsers without BIP — offer a link to per-platform instructions.
  // (Shown only on the home page variant, not on the kiosk.)
  if (variant === "banner") {
    return renderBanner({
      variant,
      icon: <Monitor className="h-4 w-4 shrink-0" />,
      title: "Install ChildCheck as an app",
      body: "Run it full-screen, like a native app — works on Chrome, Edge, and Safari.",
      actionLabel: "Install instructions",
      actionHref: "/install",
      onDismiss: () => {
        dismissNow();
        setUserDismissed(true);
      },
    });
  }

  return null;
}

function renderBanner({
  variant,
  icon,
  title,
  body,
  actionLabel,
  actionHref,
  onAction,
  onDismiss,
}: {
  variant: "banner" | "compact";
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  actionLabel: string;
  actionHref?: string;
  onAction?: () => void;
  onDismiss: () => void;
}) {
  const isCompact = variant === "compact";
  return (
    <div
      className={`w-full border-b bg-primary/5 text-foreground ${
        isCompact ? "py-1.5" : "py-2.5"
      }`}
      role="region"
      aria-label="Install app prompt"
    >
      <div
        className={`mx-auto w-full max-w-6xl px-4 sm:px-6 flex items-center gap-3 ${
          isCompact ? "text-xs" : "text-sm"
        }`}
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium leading-tight truncate">{title}</p>
          {!isCompact && (
            <p className="text-xs text-muted-foreground leading-tight mt-0.5 truncate">
              {body}
            </p>
          )}
        </div>
        {actionHref ? (
          <Button asChild size="sm" variant="default" className="h-8 shrink-0">
            <Link href={actionHref}>{actionLabel}</Link>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="default"
            className="h-8 shrink-0"
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 shrink-0 text-muted-foreground"
          aria-label="Dismiss install prompt"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
