import { redirect } from "next/navigation";

import { api } from "@repo/backend";
import { preloadAuthQuery, isAuthenticated } from "@repo/auth/server";
import { AuthGuard } from "@/components/auth/auth-guard";

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

  return <AuthGuard preloadedUser={preloadedUser}>{children}</AuthGuard>;
}
