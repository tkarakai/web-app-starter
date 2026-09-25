import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Clears stale Better Auth session cookies and redirects to /sign-in.
 *
 * Called by the dashboard layout when it detects an invalid session.
 * Cookie mutations are only allowed in Route Handlers and Server Actions,
 * not in Server Components (layouts/pages).
 */
export async function GET(): Promise<NextResponse> {
  const jar = await cookies();
  const SESSION_COOKIE_NAMES = [
    "better-auth.session_token",
    "__Secure-better-auth.session_token",
  ];

  for (const cookie of jar.getAll()) {
    if (SESSION_COOKIE_NAMES.includes(cookie.name)) {
      jar.delete(cookie.name);
    }
  }

  // A relative Location: the browser resolves it against the URL it requested.
  // `request.url` would not do: behind a proxy (a load balancer in front of a
  // standalone server) it carries the server's bind address, e.g. 0.0.0.0:3000.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: "/sign-in?session_cleared=1" },
  });

  // Ensure cookies are deleted in the response
  for (const cookie of jar.getAll()) {
    if (SESSION_COOKIE_NAMES.includes(cookie.name)) {
      response.cookies.delete({
        name: cookie.name,
        path: "/",
      });
    }
  }

  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return response;
}
