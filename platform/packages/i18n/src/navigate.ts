/**
 * Go to a path under another locale with a full page load instead of `router.push`.
 *
 * A client-side navigation across `[locale]` mounts a fresh root layout in the browser, so
 * next-themes' ThemeProvider creates its inline theme `<script>` on the client and React logs
 * "Encountered a script tag while rendering React component" (next-themes#387, open for 0.4.6).
 * A document load hydrates server-rendered HTML instead: the theme script runs from the server
 * (nonce included) and nothing warns. It also gives the new `<html lang dir>` straight from the
 * server. State below the layout was already discarded by the locale change, so nothing is lost.
 * Navigation inside one locale should keep using the router.
 */
export function navigateToLocalePath(path: string): void {
  window.location.assign(path);
}
