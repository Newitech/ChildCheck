"use client";

import { DEFAULT_FLAGS } from "@/lib/feature-flags";
import { useConfig } from "@/hooks/use-config";

/**
 * useFlags — client-side access to feature flags.
 *
 * Returns the full flags record (merged with defaults so it's never empty
 * while the config is still loading) plus an `isEnabled(key)` helper.
 */
export function useFlags(): {
  flags: Record<string, boolean>;
  isEnabled: (key: string) => boolean;
} {
  const { config } = useConfig();
  const flags: Record<string, boolean> =
    config?.flags && typeof config.flags === "object"
      ? { ...DEFAULT_FLAGS, ...config.flags }
      : { ...DEFAULT_FLAGS };
  const isEnabled = (key: string): boolean =>
    flags[key] ?? DEFAULT_FLAGS[key] ?? false;
  return { flags, isEnabled };
}
