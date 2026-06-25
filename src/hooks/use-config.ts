"use client";

import { useContext } from "react";
import { ConfigContext, type PublicConfig } from "@/components/providers";

/**
 * useConfig — access the merged branding + terminology + flags pulled from
 * /api/config by the ConfigProvider in src/components/providers.tsx.
 *
 * MUST be used inside <Providers>. Throws a clear error if not.
 */
export function useConfig(): {
  config: PublicConfig | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error(
      "useConfig() must be used inside <Providers> (ConfigProvider).",
    );
  }
  return ctx;
}
