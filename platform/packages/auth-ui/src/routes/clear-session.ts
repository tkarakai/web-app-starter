import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { clearSessionResponse } from "@web-app-starter/auth/clear-session";

/**
 * Clears stale Better Auth session cookies and redirects to /sign-in. Re-export it from
 * `app/api/auth/clear-session/route.ts`:
 *
 *   export { GET } from "@web-app-starter/auth-ui/routes/clear-session";
 *
 * Called by `ProtectedLayout` when it detects an invalid session. Cookie mutations are
 * only allowed in Route Handlers and Server Actions, not in Server Components. Which
 * cookies count as this app's follows the cookie prefix in app.config.ts; see
 * `@web-app-starter/auth/clear-session`.
 */
export async function GET(): Promise<NextResponse> {
  const jar = await cookies();
  return clearSessionResponse(jar.getAll().map((cookie) => cookie.name));
}
