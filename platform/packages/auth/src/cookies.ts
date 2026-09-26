/**
 * Better Auth cookie names, derived from `runtime.authCookiePrefix` in
 * `app.config.ts`.
 *
 * Better Auth names each cookie `<prefix>.<name>`, with `__Secure-` in front
 * over HTTPS. Every place that recognises a cookie by name — the edge proxy,
 * `clear-session`, the Convex session endpoints — goes through this module, so
 * a non-default prefix reaches all of them. Matching is exact: a look-alike
 * such as `evil-better-auth.session_token` belongs to a different app on the
 * same host and is never treated as ours.
 *
 * Dependency-free apart from the config, so edge code and Convex functions can
 * import it too.
 */
import { appConfig } from "@repo/app-config";

/** The configured prefix (`better-auth` unless the app changed it). */
export const AUTH_COOKIE_PREFIX: string = appConfig.runtime.authCookiePrefix;

const SECURE_PREFIX = "__Secure-";

/**
 * Cookies `clear-session` removes when a session turns out to be invalid: the
 * session token, Better Auth's session and account caches, the "don't remember
 * me" marker and the Convex JWT. Large values are split into `<name>.0`,
 * `<name>.1`, …; those chunks count too.
 */
export const SESSION_COOKIE_SUFFIXES = [
  "session_token",
  "session_data",
  "account_data",
  "dont_remember",
  "convex_jwt",
] as const;

/** The HTTP and HTTPS names of the session token cookie. */
export function sessionCookieNames(prefix: string = AUTH_COOKIE_PREFIX): readonly [string, string] {
  const name = `${prefix}.session_token`;
  return [name, `${SECURE_PREFIX}${name}`];
}

/** The HTTP (local development) session token cookie name. */
export const SESSION_COOKIE_NAME: string = sessionCookieNames()[0];

/** True for exactly `<prefix>.session_token` or `__Secure-<prefix>.session_token`. */
export function isSessionTokenCookie(name: string, prefix: string = AUTH_COOKIE_PREFIX): boolean {
  return sessionCookieNames(prefix).includes(name);
}

/**
 * True for any of this app's session cookies ({@link SESSION_COOKIE_SUFFIXES}),
 * over HTTP or HTTPS, including chunks. Other apps' cookies on the same host
 * never match.
 */
export function isSessionCookie(name: string, prefix: string = AUTH_COOKIE_PREFIX): boolean {
  const plain = name.startsWith(SECURE_PREFIX) ? name.slice(SECURE_PREFIX.length) : name;
  return SESSION_COOKIE_SUFFIXES.some((suffix) => {
    const base = `${prefix}.${suffix}`;
    return plain === base || (plain.startsWith(`${base}.`) && /^\d+$/.test(plain.slice(base.length + 1)));
  });
}

/**
 * The session token from a `Cookie` header: the value of the first cookie whose
 * name is exactly a session token name. Null when there is none.
 */
export function sessionTokenFromCookieHeader(
  cookieHeader: string | null,
  prefix: string = AUTH_COOKIE_PREFIX,
): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (value && isSessionTokenCookie(name, prefix)) return value;
  }
  return null;
}
