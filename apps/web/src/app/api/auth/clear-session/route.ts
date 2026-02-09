import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Clears stale Better Auth session cookies and redirects to /sign-in.
 *
 * Called by the dashboard layout when it detects an invalid session.
 * Cookie mutations are only allowed in Route Handlers and Server Actions,
 * not in Server Components (layouts/pages).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    if (cookie.name.endsWith("better-auth.session_token")) {
      jar.delete(cookie.name);
    }
  }

  const url = new URL("/sign-in", request.url);
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return response;
}
