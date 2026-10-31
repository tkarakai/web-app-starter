"use client";

import { Breadcrumb, SidebarTrigger } from "@/components/ui/localized-controls";

import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  Separator,
  SidebarInset,
  SidebarProvider,
} from "@web-app-starter/design-system";
import { AccountPageCloseButton, OrganizationInvitations, OrganizationSection, useAuthUser } from "@web-app-starter/auth-ui";
import { AppSidebar } from "@/components/projects/app-sidebar";
import { AnnouncementBannerHost } from "@/components/announcement-banner-host";

/** Page chrome for /dashboard/organization: the active organization's settings. */
export function OrganizationClient() {
  const router = useRouter();
  const authUser = useAuthUser();
  const tc = useTranslations("common");
  const to = useTranslations("organization");

  return (
    <SidebarProvider>
      <AppSidebar
        displayName={authUser?.name ?? tc("anonymous")}
        displayEmail={authUser?.email ?? undefined}
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
                <BreadcrumbPage>{to("label")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <AccountPageCloseButton />
        </header>

        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
            <OrganizationInvitations />
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Building2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">{to("settings.title")}</h1>
                <p className="text-sm text-muted-foreground">{to("settings.pageDescription")}</p>
              </div>
            </div>

            <Separator />

            <OrganizationSection />
          </div>
        </div>
        <footer className="sticky bottom-0 shrink-0 h-5 border-t border-border/40 bg-background" />
      </SidebarInset>
    </SidebarProvider>
  );
}
