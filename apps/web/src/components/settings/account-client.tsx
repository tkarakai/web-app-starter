"use client";

import { Breadcrumb, SidebarTrigger } from "@/components/ui/localized-controls";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserCog } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  Separator,
  SidebarInset,
  SidebarProvider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@web-app-starter/design-system";
import { AccountPageCloseButton, BillingSection, DeleteUserSection, OrganizationInvitations, useAuthUser, useTenancyMode } from "@web-app-starter/auth-ui";
import { AppSidebar } from "@/components/projects/app-sidebar";
import { AnnouncementBannerHost } from "@/components/announcement-banner-host";
import { ProfileSection } from "@/components/settings/profile-section";
import { SecuritySection } from "@/components/settings/security-section";

type AccountTab = "profile" | "security" | "billing";

export function AccountClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authUser = useAuthUser();
  const tc = useTranslations("common");
  const td = useTranslations("dashboard");
  const tb = useTranslations("billing");
  const individuals = useTenancyMode() === "individuals";
  const tabFrom = (value: string | null): AccountTab => value === "security" || value === "billing" ? value : "profile";
  const [tab, setTab] = React.useState<AccountTab>(tabFrom(searchParams.get("tab")));

  const urlTab = searchParams.get("tab");
  const previousUrlTab = React.useRef(urlTab);
  React.useEffect(() => {
    // Activity reconnects effects; only navigation should replace local selection.
    if (previousUrlTab.current === urlTab) return;
    previousUrlTab.current = urlTab;
    setTab(tabFrom(urlTab));
  }, [urlTab]);

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
                <BreadcrumbPage>{td("account")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <AccountPageCloseButton />
        </header>

        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
            <OrganizationInvitations />
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <UserCog className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold">{td("account")}</h1>
                  <p className="text-sm text-muted-foreground">
                    {td("profile.description")}
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <Tabs value={tab === "billing" && !individuals ? "profile" : tab} onValueChange={(value) => setTab(tabFrom(value))}>
              <TabsList>
                <TabsTrigger value="profile">{td("profile.title")}</TabsTrigger>
                <TabsTrigger value="security">{td("security")}</TabsTrigger>
                {individuals && <TabsTrigger value="billing">{tb("title")}</TabsTrigger>}
              </TabsList>
              <TabsContent value="profile" className="mt-4 space-y-6">
                <ProfileSection />
                <DeleteUserSection />
              </TabsContent>
              {individuals && (
                <TabsContent value="billing" className="mt-4">
                  <BillingSection />
                </TabsContent>
              )}
              <TabsContent value="security" className="mt-4">
                <SecuritySection />
              </TabsContent>
            </Tabs>
          </div>
        </div>
        <footer className="sticky bottom-0 shrink-0 h-5 border-t border-border/40 bg-background" />
      </SidebarInset>
    </SidebarProvider>
  );
}
