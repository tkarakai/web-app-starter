// ---------------------------------------------------------------------------
// Development-only guards
//
// Some conveniences must never run on a hosted deployment: logging auth and
// invitation emails to the console instead of sending them (the log would hold
// live sign-in links and tokens), and seeding accounts with hard-coded
// passwords. They are gated here, and the gate fails closed.
//
// "Local development" is decided from SITE_URL, the comma-separated list of app
// origins the backend trusts. It is local only when every origin is plain HTTP
// on a loopback host: localhost, a *.localhost subdomain (RFC 6761 reserves it
// for loopback; the local AWS target uses web.app.localhost), 127.0.0.1 or
// [::1]. This covers every place the starter runs Convex locally:
//   - `bun run dev` and CI E2E (`dev-start.sh`): http://localhost:<port>
//   - the local AWS target (infra/aws/local): http://web.app.localhost:8080
// A staging or production deployment serves its apps over HTTPS on a real
// domain, so it can never qualify, and a missing or unparsable SITE_URL is
// treated as not local. DEV_SEED_ENABLED alone is not trusted: it is a single
// env var that is easy to set by mistake on the wrong deployment.
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

function isLoopbackHttpOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
}

/** True only when every origin in SITE_URL is loopback HTTP. Fails closed. */
export function isLocalDevelopment(): boolean {
  const origins = (process.env.SITE_URL ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return origins.length > 0 && origins.every(isLoopbackHttpOrigin);
}

/** Error thrown when an email would be logged instead of sent on a hosted deployment. */
export const EMAIL_DELIVERY_NOT_CONFIGURED =
  "EMAIL_DELIVERY_NOT_CONFIGURED: RESEND_API_KEY is not set. Logging emails " +
  "to the console instead of sending them is allowed only in local development " +
  "(every SITE_URL origin on http://localhost). Set RESEND_API_KEY and EMAIL_FROM " +
  "on this Convex deployment.";

/**
 * Call before the console fallback for email. Throws outside local development,
 * so a deployment without an email provider fails loudly instead of silently
 * "sending" by writing sign-in links and tokens to its logs.
 */
export function assertMockEmailAllowed(): void {
  if (!isLocalDevelopment()) throw new Error(EMAIL_DELIVERY_NOT_CONFIGURED);
}
