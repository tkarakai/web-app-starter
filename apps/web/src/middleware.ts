import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Routes that require authentication. */
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

export function middleware(request: NextRequest) {
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/sign-in", "/sign-up"],
};
