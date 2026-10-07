import { AgentBrowserBridge } from "@/components/agent-browser-bridge";
import { AdminSessionLayout } from "@/components/auth/admin-session-layout";
import { AdminShellLayout } from "@/components/admin-shell-layout";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AdminSessionLayout><AdminShellLayout><AgentBrowserBridge />{children}</AdminShellLayout></AdminSessionLayout>;
}
