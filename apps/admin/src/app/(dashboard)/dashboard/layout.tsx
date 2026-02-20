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

const segmentLabels: Record<string, string> = {
  users: "Users",
  sessions: "Sessions",
  waitlist: "Waitlist",
  "audit-trail": "Audit Trail",
  settings: "Security",
  security: "Security",
  features: "Features",
  "setup-2fa": "Set Up 2FA",
};

const sectionBySegment: Record<string, string> = {
  users: "Manage",
  sessions: "Manage",
  waitlist: "Manage",
  "audit-trail": "Monitor",
  settings: "Configure",
  security: "Configure",
  features: "Configure",
  "setup-2fa": "Configure",
};

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSegment(segment: string): string {
  return segmentLabels[segment] ?? titleCase(segment);
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

  const sectionLabel = segments[0]
    ? (sectionBySegment[segments[0]] ?? titleCase(segments[0]))
    : "Manage";

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
                <BreadcrumbPage>{sectionLabel}</BreadcrumbPage>
              </BreadcrumbItem>
              {segments
                .map((segment) => formatSegment(segment))
                .filter((label) => label !== sectionLabel)
                .map((label, index) => (
                  <span key={`${label}-${index}`} className="contents">
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{label}</BreadcrumbPage>
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
