/** The auth-only browser surface and backend session allow exactly these auth methods. */
export const MCP_AUTH_PATHS = new Set([
  "/sign-in/email", "/sign-out", "/get-session", "/verify-password", "/convex/token",
  "/passkey/generate-authenticate-options", "/passkey/verify-authentication", "/passkey/list-user-passkeys",
  "/two-factor/verify-totp",
]);
export function authOnlyPath(path: string) {
  return path === "/sign-in" || path === "/settings/agent-access" || path === "/api/agent/authorize"
    || path === "/api/agent/decision" || path === "/api/agent/token" || path === "/api/auth/clear-session"
    || path === "/.well-known/oauth-authorization-server"
    || path === "/icon.svg" || path === "/favicon.ico" || path === "/apple-touch-icon.png"
    || path.startsWith("/_next/static/") || path.startsWith("/_next/webpack-hmr")
    || path.startsWith("/api/auth/") && MCP_AUTH_PATHS.has(path.slice("/api/auth".length));
}
