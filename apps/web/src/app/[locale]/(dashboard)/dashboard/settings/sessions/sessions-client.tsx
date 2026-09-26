"use client";

import { Breadcrumb, SidebarTrigger } from "@/components/ui/localized-controls";

import { useRouter } from "next/navigation";
import { ArrowLeft, Shield } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Separator,
  SidebarInset,
  SidebarProvider,
} from "@web-app-starter/design-system";
import { useAuthUser } from "@/components/auth/auth-guard";
import { AppSidebar } from "@/components/projects/app-sidebar";
import { AnnouncementBannerHost } from "@/components/announcement-banner-host";
import { SessionsList } from "@/components/settings/sessions-list";

/**
 * Page chrome for /dashboard/settings/sessions.
 *
 * The session list itself lives in `@/components/settings/sessions-list` and is
 * shared with the Security settings tab. This file used to carry a second,
 * byte-identical copy of that logic; every fix then had to be applied twice, and
 * applying it to only one copy looked correct while changing nothing (two of the
 * bugs in PR #81 were exactly that). Keep this file presentational.
 */
export function SessionsClient() {
  const router = useRouter();
  const authUser = useAuthUser();
  const tc = useTranslations("common");
  const ts = useTranslations("dashboard.sessions");
  const td = useTranslations("dashboard");

  const displayName = authUser?.name ?? tc("anonymous");
  const displayEmail = authUser?.email;

  return (
    <SidebarProvider>
      <AppSidebar
        displayName={displayName}
        displayEmail={displayEmail ?? undefined}
        selectedProjectId={null}
        onSelectProject={() => router.push("/dashboard")}
      />
      <SidebarInset className="flex flex-col h-dvh">
        <AnnouncementBannerHost className="shrink-0" />
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/40 bg-background px-4">
          <SidebarTrigger className="-ms-1" />
          <Separator
            orientation="vertical"
            className="me-2 data-[orientation=vertical]:h-4"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  className="cursor-pointer"
                  onClick={() => router.push("/dashboard")}
                >
                  {td("projects")}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{ts("title")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>

        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
            {/* Page header */}
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold">{ts("title")}</h1>
                  <p className="text-sm text-muted-foreground">
                    {ts("description")}
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <SessionsList />

            {/* Back link */}
            <div className="pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/dashboard")}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {ts("backToDashboard")}
              </Button>
            </div>
          </div>
        </div>
        <footer className="sticky bottom-0 shrink-0 h-5 border-t border-border/40 bg-background" />
      </SidebarInset>
    </SidebarProvider>
  );
}
