import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { clearSessionResponse } from "@repo/auth/clear-session";

/**
 * Clears stale Better Auth session cookies and redirects to /sign-in.
 *
 * Called by the dashboard layout when it detects an invalid session.
 * Cookie mutations are only allowed in Route Handlers and Server Actions,
 * not in Server Components (layouts/pages). Which cookies count as this app's
 * follows the cookie prefix in app.config.ts; see `@repo/auth/clear-session`.
 */
export async function GET(): Promise<NextResponse> {
  const jar = await cookies();
  return clearSessionResponse(jar.getAll().map((cookie) => cookie.name));
}
