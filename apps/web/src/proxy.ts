import { type NextRequest, NextResponse } from "next/server";
import { authRedirect, stripLocalePrefix, WEB_AUTH_ROUTES } from "@web-app-starter/auth-ui/proxy";
import createIntlMiddleware from "next-intl/middleware";
import { defaultLocale, locales } from "@web-app-starter/i18n";
import {
  checkEdgeRateLimit,
  positiveInt,
  getClientIp,
  rateLimitResponse,
  setRateLimitHeaders,
  type EdgeRateLimitConfig,
} from "@web-app-starter/edge-rate-limit";

const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always",
});

const RATE_LIMIT_CONFIG: EdgeRateLimitConfig = {
  windowSeconds: positiveInt(process.env.EDGE_RATE_LIMIT_WINDOW, 60),
  maxRequests: positiveInt(process.env.EDGE_RATE_LIMIT_MAX, 200),
  maxMapSize: positiveInt(process.env.EDGE_RATE_LIMIT_MAP_MAX_SIZE, 10000),
};

export function proxy(request: NextRequest) {
  // --- Rate limiting (first check) ---
  const clientIp = getClientIp(request);
  const rl = checkEdgeRateLimit(clientIp, RATE_LIMIT_CONFIG);

  if (!rl.allowed) {
    return rateLimitResponse(RATE_LIMIT_CONFIG, rl);
  }

  const { pathname } = request.nextUrl;

  // Skip locale handling for API routes
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // --- Auth redirects (checked before intl to avoid unnecessary rewrites) ---
  const redirect = authRedirect(request, {
    protectedPrefixes: ["/dashboard"],
    authRoutes: WEB_AUTH_ROUTES,
    locales,
    defaultLocale,
  });
  if (redirect) return redirect;
  const strippedPath = stripLocalePrefix(pathname, locales);

  // --- CSP headers ---
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";

  // The Convex deployment's own origins, read at request time: a local backend
  // on dynamic ports in dev, a custom domain, or the local AWS target
  // (infra/aws) are not on *.convex.cloud. Both the API origin and its WebSocket
  // form (ws/wss) are allowed, plus the site URL for HTTP actions.
  const convexOrigins = (() => {
    const origins: string[] = [];
    try {
      const url = new URL(process.env.CONVEX_URL ?? "");
      origins.push(url.origin, `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`);
    } catch {
      // Invalid URL — skip
    }
    try {
      const siteUrl = new URL(process.env.CONVEX_SITE_URL ?? "");
      if (!origins.includes(siteUrl.origin)) {
        origins.push(siteUrl.origin);
      }
    } catch {
      // Invalid URL — skip
    }
    return origins.length > 0 ? ` ${origins.join(" ")}` : "";
  })();

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
    `connect-src 'self' https://*.convex.cloud wss://*.convex.cloud${convexOrigins}`,
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
  setRateLimitHeaders(intlResponse, RATE_LIMIT_CONFIG, rl);

  return intlResponse;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-touch-icon\\.png).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
