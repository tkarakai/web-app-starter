import { redirect } from "next/navigation";

import { api } from "@/convex/_generated/api";
import { preloadAuthQuery, isAuthenticated } from "@/lib/auth-server";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const authed = await isAuthenticated();
  if (!authed) {
    redirect("/sign-in");
  }

  // Preload the user query so the dashboard can render immediately with SSR data.
  const preloadedUser = await preloadAuthQuery(api.auth.getCurrentUser);

  return <DashboardClient preloadedUser={preloadedUser} />;
}
