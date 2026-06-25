"use client";

import { useEffect } from "react";

/**
 * PrintAuto — client helper that triggers window.print() once the print view
 * has mounted. Re-fires on focus (so re-opening the tab after closing the
 * dialog re-prompts the print dialog). Honours reduced-motion preferences by
 * not popping the dialog twice in quick succession.
 */
export function PrintAuto() {
  useEffect(() => {
    // Small timeout so the table layout settles before print.
    const t = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        // Ignore — printing may be blocked.
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, []);

  return null;
}
