"use client";

import { DEFAULT_TERMINOLOGY, type Terminology } from "@/lib/branding";
import { useConfig } from "@/hooks/use-config";

/**
 * useTerminology — client-side access to the merged terminology table.
 *
 * Returns:
 *   - `terminology`: the full merged Terminology object (or DEFAULT_TERMINOLOGY
 *     while loading / on error so the UI never throws on undefined term).
 *   - `t(key)`: resolver that falls back to the default if a term is missing.
 */
export function useTerminology(): {
  terminology: Terminology;
  t: (key: keyof Terminology) => string;
} {
  const { config } = useConfig();
  const terminology: Terminology = config?.terminology ?? DEFAULT_TERMINOLOGY;
  const t = (key: keyof Terminology): string =>
    terminology[key] ?? DEFAULT_TERMINOLOGY[key] ?? String(key);
  return { terminology, t };
}
