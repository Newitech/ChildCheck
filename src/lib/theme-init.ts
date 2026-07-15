/**
 * Inline script to prevent flash-of-wrong-theme (FOUC) on page load.
 * Runs before React hydrates, reading localStorage and adding the `dark`
 * class to <html> immediately.
 *
 * This is a plain string (NOT a client component) so it can be used in
 * server-rendered layouts via dangerouslySetInnerHTML.
 *
 * Usage in a layout:
 *   <script dangerouslySetInnerHTML={{ __html: themeInitScript("theme") }} />
 *   <script dangerouslySetInnerHTML={{ __html: themeInitScript("kiosk-theme") }} />
 */
export function themeInitScript(storageKey: string = "theme"): string {
  return `
(function() {
  try {
    var t = localStorage.getItem('${storageKey}');
    if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch(e) {}
})();
`;
}
