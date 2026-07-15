"use client";

import { SessionProvider } from "next-auth/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { Branding, Terminology } from "@/lib/branding";

/**
 * Client-side providers wrapper.
 *
 * Wraps the app in:
 *   1. NextAuth SessionProvider (so client components can call useSession).
 *   2. ConfigProvider — fetches /api/config (branding + terminology + flags)
 *      once on mount and on window focus, exposes via useConfig().
 */

export interface PublicConfig {
  branding: Branding;
  terminology: Terminology;
  flags: Record<string, boolean>;
  orgType?: string;
  /** JS getDay() index of the first day of the week (0=Sun .. 6=Sat). */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Daily check-out code length (default 3). */
  dailyCodeLength?: number;
  /** Daily check-out code character set: "alphanumeric" | "numeric". */
  dailyCodeCharset?: "alphanumeric" | "numeric";
  /**
   * Realtime (Socket.io) mini-service port, read from REALTIME_PORT (default
   * 3003) by /api/config. The client uses this in `io("/?XTransformPort=<port>")`
   * so the realtime port can be reconfigured without code changes.
   */
  realtimePort?: number;
}

interface ConfigContextValue {
  config: PublicConfig | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

// Exported for the useConfig hook to consume. Not part of the public API.
export { ConfigContext };

function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
      const data = (await res.json()) as PublicConfig;
      setConfig(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refetch on window focus (lightweight — endpoint caches for 5s server-side).
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return (
    <ConfigContext.Provider value={{ config, loading, error, refresh }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ConfigProvider>{children}</ConfigProvider>
    </SessionProvider>
  );
}
