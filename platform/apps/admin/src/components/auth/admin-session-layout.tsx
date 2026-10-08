import { redirect } from "next/navigation";

import { api } from "@repo/backend";
import {
  preloadAuthQuery,
  fetchAuthQuery,
  isAuthenticated,
} from "@web-app-starter/auth/server";
import { AuthGuard } from "@/components/auth/auth-guard";

export async function AdminSessionLayout({
  children, authorizationOnly = false,
}: {
  children: React.ReactNode;
  authorizationOnly?: boolean;
}) {
  const authed = await isAuthenticated();
  if (!authed) {
    redirect("/api/auth/clear-session");
  }

  let preloadedUser;
  try {
    preloadedUser = await preloadAuthQuery(api.platform.auth.getCurrentUser);
  } catch {
    redirect("/api/auth/clear-session");
  }

  const status = await fetchAuthQuery(api.platform.sessionAssurance.status, {});
  if (authorizationOnly !== (status?.authPurpose === "mcp-authorization")) redirect("/api/auth/clear-session");
  const pending = authorizationOnly ? null : await fetchAuthQuery(api.platform.adminInvitations.getMyOnboardingStatus);
  if (pending && !pending.completed) redirect("/onboarding");

  // Verify user has admin role (fetchAuthQuery returns the actual data)
  const user = await fetchAuthQuery(api.platform.auth.getCurrentUser);
  if (!user || (user as Record<string, unknown>).role !== "admin") {
    redirect("/api/auth/clear-session");
  }

  // Banned admins cannot access the dashboard (spec §14)
  if ((user as Record<string, unknown>).banned === true) {
    redirect("/forbidden");
  }

  return (
    <AuthGuard preloadedUser={preloadedUser} authorizationOnly={authorizationOnly}>
      {children}
    </AuthGuard>
  );
}
