import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { defaultLocale, locales } from "@repo/i18n";
import {
  checkEdgeRateLimit,
  positiveInt,
  getClientIp,
  rateLimitResponse,
  setRateLimitHeaders,
  type EdgeRateLimitConfig,
} from "@repo/edge-rate-limit";

const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always",
});

const RATE_LIMIT_CONFIG: EdgeRateLimitConfig = {
  windowSeconds: positiveInt(process.env.EDGE_RATE_LIMIT_WINDOW, 60),
  maxRequests: positiveInt(process.env.EDGE_RATE_LIMIT_MAX, 300),
  maxMapSize: positiveInt(process.env.EDGE_RATE_LIMIT_MAP_MAX_SIZE, 10000),
};

/**
 * Extract the pathname without the locale prefix.
 */
function stripLocalePrefix(pathname: string): string {
  for (const locale of locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(`/${locale}`.length) || "/";
    }
  }
  return pathname;
}

export function proxy(request: NextRequest) {
  // Skip middleware for API routes (waitlist proxy, etc.)
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // --- Rate limiting (first check) ---
  const clientIp = getClientIp(request);
  const rl = checkEdgeRateLimit(clientIp, RATE_LIMIT_CONFIG);

  if (!rl.allowed) {
    return rateLimitResponse(RATE_LIMIT_CONFIG, rl);
  }

  // --- CSP headers ---
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";

  // When adding third-party services, add their origins to the relevant directives:
  //   Analytics (PostHog/Plausible): script-src, connect-src
  //   External images/avatars:       img-src
  //   External fonts:                font-src, style-src
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  // Forward custom headers via request so Server Components can read them
  // via headers(). next-intl's middleware copies request.headers and passes
  // them through NextResponse.next/rewrite({ request: { headers } }).
  const strippedPath = stripLocalePrefix(request.nextUrl.pathname);
  request.headers.set("x-nonce", nonce);
  request.headers.set("x-pathname", strippedPath);

  // Run next-intl middleware (locale detection, rewrite, cookie)
  const intlResponse = intlMiddleware(request);

  // Set CSP on the response (sent to the browser)
  intlResponse.headers.set("Content-Security-Policy", csp);

  // Rate limit headers on successful responses
  setRateLimitHeaders(intlResponse, RATE_LIMIT_CONFIG, rl);

  return intlResponse;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
