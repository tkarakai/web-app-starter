import { redirect } from "next/navigation";

import { api } from "@repo/backend";
import {
  preloadAuthQuery,
  fetchAuthQuery,
  isAuthenticated,
} from "@repo/auth/server";
import { AuthGuard } from "@/components/auth/auth-guard";
import { AdminShellLayout } from "@/components/admin-shell-layout";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) {
    redirect("/api/auth/clear-session");
  }

  let preloadedUser;
  try {
    preloadedUser = await preloadAuthQuery(api.auth.getCurrentUser);
  } catch {
    redirect("/api/auth/clear-session");
  }

  // Verify user has admin role (fetchAuthQuery returns the actual data)
  const user = await fetchAuthQuery(api.auth.getCurrentUser);
  if (!user || (user as Record<string, unknown>).role !== "admin") {
    redirect("/api/auth/clear-session");
  }

  // Banned admins cannot access the dashboard (spec §14)
  if ((user as Record<string, unknown>).banned === true) {
    redirect("/forbidden");
  }

  // TODO(stage-6): Admins without 2FA set up must complete onboarding first (spec §14).
  // The /onboarding route is created in Stage 6. Uncomment when that route exists.
  // if ((user as Record<string, unknown>).twoFactorEnabled !== true) {
  //   redirect("/onboarding");
  // }

  return (
    <AuthGuard preloadedUser={preloadedUser}>
      <AdminShellLayout>{children}</AdminShellLayout>
    </AuthGuard>
  );
}
