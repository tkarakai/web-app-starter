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

const RATE_LIMIT_CONFIG: EdgeRateLimitConfig = {
  windowSeconds: Number(process.env.EDGE_RATE_LIMIT_WINDOW ?? "60"),
  maxRequests: Number(process.env.EDGE_RATE_LIMIT_MAX ?? "300"),
  maxMapSize: Number(process.env.EDGE_RATE_LIMIT_MAP_MAX_SIZE ?? "10000"),
};

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

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
  intlResponse.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_CONFIG.maxRequests));
  intlResponse.headers.set("X-RateLimit-Remaining", String(rl.remaining));
  intlResponse.headers.set("X-RateLimit-Reset", String(rl.resetAt));

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
