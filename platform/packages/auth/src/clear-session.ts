import { NextResponse } from "next/server";

import { AUTH_COOKIE_PREFIX, isSessionCookie } from "./cookies";

/**
 * The response of an app's `/api/auth/clear-session` route: delete this app's
 * stale session cookies and redirect to `/sign-in?session_cleared=1`.
 *
 * Only cookies named by {@link isSessionCookie} for the configured prefix are
 * deleted. Another app on the same host (localhost during development) keeps
 * its session, even when it also uses Better Auth under a different prefix.
 *
 * @param cookieNames names of the cookies the request carried
 */
export function clearSessionResponse(
  cookieNames: readonly string[],
  prefix: string = AUTH_COOKIE_PREFIX,
): NextResponse {
  // A relative Location: the browser resolves it against the URL it requested.
  // `request.url` would not do: behind a proxy (a load balancer in front of a
  // standalone server) it carries the server's bind address, not the public host.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: "/sign-in?session_cleared=1" },
  });

  for (const name of cookieNames) {
    if (isSessionCookie(name, prefix)) {
      response.cookies.delete({ name, path: "/" });
    }
  }

  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return response;
}
