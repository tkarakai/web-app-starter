import { AdminSessionLayout } from "@/components/auth/admin-session-layout";

/** Consent has the same session checks as the dashboard, with no application shell. */
export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return <AdminSessionLayout authorizationOnly><main className="min-h-dvh bg-background">{children}</main></AdminSessionLayout>;
}
