import { type NextRequest, NextResponse } from "next/server";
import { sessionCookieNames } from "@web-app-starter/auth/cookies";
import { hasSessionCookie } from "@web-app-starter/edge-rate-limit";

/** The auth part of an app's `proxy.ts`: which paths need a session and which skip it. */
export interface AuthRedirectOptions {
  /** Path prefixes that require a session (matched after the locale prefix is stripped). */
  protectedPrefixes: readonly string[];
  /**
   * Auth pages a signed-in user skips (sent to `homePath`). Leave out `/verify-email`:
   * signed-in but unverified users must reach it.
   */
  authRoutes: readonly string[];
  /** Where a signed-out user goes. Default `/sign-in`. */
  signInPath?: string;
  /** Where a signed-in user on an auth page goes. Default `/dashboard`. */
  homePath?: string;
  /**
   * Locales used as the first path segment. When given, paths are matched without the
   * locale and redirects keep it (the sign-in redirect prefers the NEXT_LOCALE cookie).
   */
  locales?: readonly string[];
  /** Locale used when the path has none. Required with `locales`. */
  defaultLocale?: string;
}

/** Web app defaults: protected dashboard, the four guest-only auth pages. */
export const WEB_AUTH_ROUTES = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"] as const;

/** `/de/dashboard` → `/dashboard`; paths without a known locale are returned unchanged. */
export function stripLocalePrefix(pathname: string, locales: readonly string[]): string {
  for (const locale of locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(`/${locale}`.length) || "/";
    }
  }
  return pathname;
}

/** The locale in the first path segment, or `fallback`. */
export function localeFromPath(pathname: string, locales: readonly string[], fallback: string): string {
  const match = pathname.match(/^\/([^/]+)/);
  if (match && locales.includes(match[1])) return match[1];
  return fallback;
}

function localeFromCookie(request: NextRequest, locales: readonly string[]): string | null {
  const locale = request.cookies.get("NEXT_LOCALE")?.value;
  return locale && locales.includes(locale) ? locale : null;
}

/**
 * Session-cookie redirects for an app's `proxy.ts`. Returns a redirect response, or
 * `null` to continue. A cookie check only: pages still validate the session
 * (`ProtectedLayout`), and `?session_cleared` (set by the clear-session route) lets a
 * stale cookie reach the sign-in page instead of looping back to the dashboard.
 */
export function authRedirect(request: NextRequest, options: AuthRedirectOptions): NextResponse | null {
  const { pathname } = request.nextUrl;
  const locales = options.locales ?? [];
  const localized = locales.length > 0;
  const fallbackLocale = options.defaultLocale ?? locales[0] ?? "";
  const path = localized ? stripLocalePrefix(pathname, locales) : pathname;
  const locale = localized ? localeFromPath(pathname, locales, fallbackLocale) : "";
  const prefix = (value: string) => (value ? `/${value}` : "");
  const hasSession = hasSessionCookie(request, sessionCookieNames());

  if (options.protectedPrefixes.some((protectedPrefix) => path.startsWith(protectedPrefix)) && !hasSession) {
    const preferred = localized ? localeFromCookie(request, locales) ?? locale : "";
    return NextResponse.redirect(new URL(`${prefix(preferred)}${options.signInPath ?? "/sign-in"}`, request.url));
  }

  const isSessionCleared = request.nextUrl.searchParams.has("session_cleared");
  if (options.authRoutes.includes(path) && hasSession && !isSessionCleared) {
    return NextResponse.redirect(new URL(`${prefix(locale)}${options.homePath ?? "/dashboard"}`, request.url));
  }

  return null;
}
