"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "sonner";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Separator,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/design-system";
import { useAuthUser } from "@/components/auth/auth-guard";
import { AdminSidebar } from "@/components/admin-sidebar";

/** Map route segments to display labels. */
const segmentLabels: Record<string, string> = {
  dashboard: "Dashboard",
  users: "Users",
  sessions: "Sessions",
  waitlist: "Waitlist",
  "audit-trail": "Audit Trail",
  settings: "Settings",
};

function formatSegment(segment: string): string {
  return segmentLabels[segment] ?? segment;
}

export default function DashboardShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const user = useAuthUser();

  // Build breadcrumb segments from the pathname, starting after "/dashboard".
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .filter((s) => s !== "dashboard");

  return (
    <SidebarProvider>
      <AdminSidebar
        displayName={user?.name ?? "Admin"}
        displayEmail={user?.email}
      />
      <SidebarInset className="flex flex-col h-dvh min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/40 bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Dashboard</BreadcrumbPage>
              </BreadcrumbItem>
              {segments.map((segment) => (
                <span key={segment} className="contents">
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{formatSegment(segment)}</BreadcrumbPage>
                  </BreadcrumbItem>
                </span>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          {children}
        </div>
        <footer className="sticky bottom-0 shrink-0 h-5 border-t border-border/40 bg-background" />
      </SidebarInset>
      <Toaster position="bottom-right" duration={4000} />
    </SidebarProvider>
  );
}
