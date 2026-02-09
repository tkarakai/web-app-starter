import { type NextRequest, NextResponse } from "next/server";
import {
  checkEdgeRateLimit,
  positiveInt,
  getClientIp,
  hasSessionCookie,
  rateLimitResponse,
  setRateLimitHeaders,
  type EdgeRateLimitConfig,
} from "@repo/edge-rate-limit";

const RATE_LIMIT_CONFIG: EdgeRateLimitConfig = {
  windowSeconds: positiveInt(process.env.EDGE_RATE_LIMIT_WINDOW, 60),
  maxRequests: positiveInt(process.env.EDGE_RATE_LIMIT_MAX, 100),
  maxMapSize: positiveInt(process.env.EDGE_RATE_LIMIT_MAP_MAX_SIZE, 10000),
};

/** Routes that require authentication. */
const PROTECTED_PREFIXES = ["/dashboard"];

/** Auth routes that authenticated users should skip. */
const AUTH_ROUTES = ["/sign-in"];

export function proxy(request: NextRequest) {
  // --- Rate limiting (first check) ---
  const clientIp = getClientIp(request);
  const rl = checkEdgeRateLimit(clientIp, RATE_LIMIT_CONFIG);

  if (!rl.allowed) {
    return rateLimitResponse(RATE_LIMIT_CONFIG, rl);
  }

  const { pathname } = request.nextUrl;
  const hasSession = hasSessionCookie(request);

  // Unauthenticated users hitting a protected route → sign-in
  if (
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    !hasSession
  ) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  // Authenticated users hitting auth pages → dashboard
  if (AUTH_ROUTES.includes(pathname) && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);

  // Rate limit headers on successful responses
  setRateLimitHeaders(response, RATE_LIMIT_CONFIG, rl);

  return response;
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
