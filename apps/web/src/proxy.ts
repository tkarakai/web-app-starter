import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { defaultLocale, locales } from "@repo/i18n";

import {
  checkEdgeRateLimit,
  type EdgeRateLimitConfig,
} from "@/lib/edge-rate-limit";

const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always",
});

/** Parse an env var as a positive integer, falling back to a safe default. */
function positiveInt(envVar: string | undefined, defaultValue: number): number {
  const parsed = parseInt(envVar ?? "", 10);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

const RATE_LIMIT_CONFIG: EdgeRateLimitConfig = {
  windowSeconds: positiveInt(process.env.EDGE_RATE_LIMIT_WINDOW, 60),
  maxRequests: positiveInt(process.env.EDGE_RATE_LIMIT_MAX, 200),
  maxMapSize: positiveInt(process.env.EDGE_RATE_LIMIT_MAP_MAX_SIZE, 10000),
};

/** Routes that require authentication (matched against the locale-stripped path). */
const PROTECTED_PREFIXES = ["/dashboard"];

/** Auth routes that authenticated users should skip. */
const AUTH_ROUTES = ["/sign-in", "/sign-up"];

/**
 * Quick cookie-presence check (Edge-compatible, no backend call).
 * Better Auth names the cookie `better-auth.session_token` in dev (HTTP)
 * and `__Secure-better-auth.session_token` in production (HTTPS).
 */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => c.name.endsWith("better-auth.session_token"));
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Extract the pathname without the locale prefix so auth rules
 * work the same regardless of which locale is active.
 */
function stripLocalePrefix(pathname: string): string {
  for (const locale of locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(`/${locale}`.length) || "/";
    }
  }
  return pathname;
}

/**
 * Detect the locale from the URL path (first segment).
 * Falls back to `defaultLocale` when the segment isn't a known locale.
 */
function getLocaleFromPath(pathname: string): string {
  const match = pathname.match(/^\/([^/]+)/);
  if (match && (locales as readonly string[]).includes(match[1])) {
    return match[1];
  }
  return defaultLocale;
}

/**
 * Get the user's preferred locale from the NEXT_LOCALE cookie.
 * Falls back to null if not set.
 */
function getLocaleFromCookie(request: NextRequest): string | null {
  const locale = request.cookies.get("NEXT_LOCALE")?.value;
  if (locale && (locales as readonly string[]).includes(locale)) {
    return locale;
  }
  return null;
}

export function proxy(request: NextRequest) {
  // --- Rate limiting (first check) ---
  const clientIp = getClientIp(request);
  const rl = checkEdgeRateLimit(clientIp, RATE_LIMIT_CONFIG);

  if (!rl.allowed) {
    const retryAfterSeconds = Math.ceil(
      (rl.resetAt - Date.now()) / 1000,
    );
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(retryAfterSeconds, 1)),
        "X-RateLimit-Limit": String(RATE_LIMIT_CONFIG.maxRequests),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(rl.resetAt),
      },
    });
  }

  // --- Auth redirects ---
  const { pathname } = request.nextUrl;

  // Skip locale handling for API routes
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // --- Auth redirects (checked before intl to avoid unnecessary rewrites) ---
  const strippedPath = stripLocalePrefix(pathname);
  const hasSession = hasSessionCookie(request);
  const locale = getLocaleFromPath(pathname);

  // Unauthenticated users hitting a protected route → sign-in
  // Respect the NEXT_LOCALE cookie (user's preferred locale from before logout)
  if (
    PROTECTED_PREFIXES.some((prefix) => strippedPath.startsWith(prefix)) &&
    !hasSession
  ) {
    const preferredLocale = getLocaleFromCookie(request) || locale;
    return NextResponse.redirect(new URL(`/${preferredLocale}/sign-in`, request.url));
  }

  // Authenticated users hitting auth pages → dashboard
  if (AUTH_ROUTES.includes(strippedPath) && hasSession) {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
  }

  // --- CSP headers ---
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";

  // In dev, Convex runs locally on a dynamic port (e.g. http://127.0.0.1:3210).
  // Derive both http and ws origins so the CSP allows API calls and WebSocket sync.
  const devConvexOrigins = isDev
    ? (() => {
        try {
          const url = new URL(process.env.NEXT_PUBLIC_CONVEX_URL ?? "");
          const httpOrigin = url.origin;
          const wsOrigin = `ws://${url.host}`;
          return ` ${httpOrigin} ${wsOrigin}`;
        } catch {
          return "";
        }
      })()
    : "";

  // When adding third-party services, add their origins to the relevant directives:
  //   Analytics (PostHog/Plausible): script-src, connect-src
  //   Error monitoring (Sentry):     script-src, connect-src
  //   Payment (Stripe/Square):       script-src, connect-src, frame-src
  //   External images/avatars:       img-src
  //   External fonts:                font-src, style-src
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' https://*.convex.cloud wss://*.convex.cloud${devConvexOrigins}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  // Forward custom headers via request so Server Components can read them
  // via headers(). next-intl's middleware copies request.headers and passes
  // them through NextResponse.next/rewrite({ request: { headers } }).
  request.headers.set("x-nonce", nonce);
  request.headers.set("x-pathname", strippedPath);

  // --- Locale handling (detection, rewrite, cookie) ---
  const intlResponse = intlMiddleware(request);

  // Set CSP on the response (sent to the browser)
  intlResponse.headers.set("Content-Security-Policy", csp);

  // Rate limit headers on successful responses
  intlResponse.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_CONFIG.maxRequests));
  intlResponse.headers.set("X-RateLimit-Remaining", String(rl.remaining));
  intlResponse.headers.set("X-RateLimit-Reset", String(rl.resetAt));

  return intlResponse;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
