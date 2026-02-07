import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { api } from "@repo/backend";
import { preloadAuthQuery, isAuthenticated } from "@repo/auth/server";
import { AuthGuard } from "@/components/auth/auth-guard";

/**
 * Delete stale Better Auth session cookies so the proxy layer doesn't
 * bounce the user back to /dashboard after we redirect to /sign-in.
 */
async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    if (cookie.name.endsWith("better-auth.session_token")) {
      jar.delete(cookie.name);
    }
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) {
    await clearSessionCookies();
    redirect("/sign-in");
  }

  let preloadedUser;
  try {
    preloadedUser = await preloadAuthQuery(api.auth.getCurrentUser);
  } catch {
    await clearSessionCookies();
    redirect("/sign-in");
  }

  return <AuthGuard preloadedUser={preloadedUser}>{children}</AuthGuard>;
}
