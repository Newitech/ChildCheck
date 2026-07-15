"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/domain/theme-provider";

/**
 * ThemeToggle — a small icon button that toggles dark/light mode.
 * Used in the admin/volunteer/guardian layouts (next to the user menu).
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}

/**
 * KioskThemeToggle — same toggle but with larger touch targets for kiosk use.
 * Uses the "kiosk-theme" storage key so each kiosk remembers its own setting.
 */
export function KioskThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      className="gap-1.5"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <>
          <Sun className="h-4 w-4" />
          <span className="text-xs">Light</span>
        </>
      ) : (
        <>
          <Moon className="h-4 w-4" />
          <span className="text-xs">Dark</span>
        </>
      )}
    </Button>
  );
}
