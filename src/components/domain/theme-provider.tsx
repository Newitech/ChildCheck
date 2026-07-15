"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * ThemeProvider — manages dark/light mode by toggling `class="dark"` on <html>.
 *
 * Two storage keys:
 *   - "theme" — for the admin/volunteer/guardian dashboards (shared across
 *     all non-kiosk pages on this device).
 *   - "kiosk-theme" — for kiosk pages only (per-kiosk-instance, so each
 *     physical kiosk can independently choose dark or light).
 *
 * The CSS variables for both themes are defined in globals.css (`.dark { ... }`).
 * Tailwind's `darkMode: "class"` config makes `dark:` utilities work.
 */

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Apply the theme to <html> + persist to localStorage. */
function applyTheme(theme: Theme, storageKey: string) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // localStorage may be unavailable (private mode) — non-fatal.
  }
}

/** Read the stored theme, falling back to the system preference. */
function readTheme(storageKey: string): Theme {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // non-fatal
  }
  // Fall back to system preference.
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function ThemeProvider({
  children,
  kiosk = false,
}: {
  children: ReactNode;
  kiosk?: boolean;
}) {
  const storageKey = kiosk ? "kiosk-theme" : "theme";
  const [theme, setThemeState] = useState<Theme>("light");

  // Read on mount (client-only — avoids hydration mismatch).
  // The setState-in-effect is intentional here: we read from localStorage
  // (a client-only API) on first render to apply the persisted theme.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const t = readTheme(storageKey);
    setThemeState(t);
    applyTheme(t, storageKey);
  }, [storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      applyTheme(t, storageKey);
    },
    [storageKey],
  );

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next, storageKey);
      return next;
    });
  }, [storageKey]);

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Hook to read + toggle the theme. Must be used inside a ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback (shouldn't happen — provider wraps the app).
    return {
      theme: "light",
      toggle: () => {},
      setTheme: () => {},
    };
  }
  return ctx;
}
