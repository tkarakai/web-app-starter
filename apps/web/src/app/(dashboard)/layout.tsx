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
    redirect("/sign-in");
  }

  let preloadedUser;
  try {
    preloadedUser = await preloadAuthQuery(api.auth.getCurrentUser);
  } catch {
    redirect("/sign-in");
  }

  return <AuthGuard preloadedUser={preloadedUser}>{children}</AuthGuard>;
}
