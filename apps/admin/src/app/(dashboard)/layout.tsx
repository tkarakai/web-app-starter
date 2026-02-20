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

  return (
    <AuthGuard preloadedUser={preloadedUser}>
      <AdminShellLayout>{children}</AdminShellLayout>
    </AuthGuard>
  );
}
