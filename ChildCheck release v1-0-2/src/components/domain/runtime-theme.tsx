"use client";

import { useEffect } from "react";

import { useConfig } from "@/hooks/use-config";

/**
 * RuntimeTheme — applies the organisation's primary/accent colours to CSS
 * variables on <html> at runtime.
 *
 * The shadcn theme tokens (`--primary`, `--ring`, `--accent`, …) are
 * referenced by Tailwind utilities like `bg-primary`, `text-primary`, etc.
 * By overriding them at runtime we re-skin the whole app instantly —
 * without a reload — whenever an admin saves new branding.
 *
 * Safe by design: no-op during SSR, wrapped in try/catch.
 */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Standard WCAG relative luminance (sRGB) for a hex colour. */
function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pick a foreground that contrasts with the given background hex. */
function pickFg(bgHex: string): string {
  return luminance(bgHex) < 0.5 ? "#ffffff" : "#1a2b28";
}

export function RuntimeTheme() {
  const { config } = useConfig();
  const branding = config?.branding;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const root = document.documentElement;
      if (!branding) return;

      const primary = branding.primaryColor || "#0f9d8a";
      const accent = branding.accentColor || "#e8a33d";

      root.style.setProperty("--primary", primary);
      root.style.setProperty("--ring", primary);
      root.style.setProperty("--sidebar-primary", primary);
      root.style.setProperty("--sidebar-ring", primary);
      root.style.setProperty("--chart-1", primary);
      root.style.setProperty("--primary-foreground", pickFg(primary));

      root.style.setProperty("--accent", accent);
      root.style.setProperty("--chart-2", accent);
      root.style.setProperty("--accent-foreground", pickFg(accent));
    } catch {
      // never crash the app over a theme variable
    }
  }, [branding?.primaryColor, branding?.accentColor, branding]);

  return null;
}
