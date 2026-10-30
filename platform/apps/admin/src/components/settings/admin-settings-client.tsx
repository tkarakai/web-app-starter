"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { UserCog } from "lucide-react";

import {
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@web-app-starter/design-system";
import { AdminProfileSection } from "@/components/settings/admin-profile-section";
import { AdminSecuritySection } from "@/components/settings/admin-security-section";

export function AdminSettingsClient() {
  const searchParams = useSearchParams();
  const [tab, setTab] = React.useState<"profile" | "security">(
    searchParams.get("tab") === "security" ? "security" : "profile",
  );

  const urlTab = searchParams.get("tab");
  const previousUrlTab = React.useRef(urlTab);
  React.useEffect(() => {
    // Activity reconnects effects; only navigation should replace local selection.
    if (previousUrlTab.current === urlTab) return;
    previousUrlTab.current = urlTab;
    setTab(urlTab === "security" ? "security" : "profile");
  }, [urlTab]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <UserCog className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your app-operator account preferences and security.
            </p>
          </div>
        </div>
      </div>

      <Separator />

      <Tabs value={tab} onValueChange={(value) => setTab(value === "security" ? "security" : "profile")}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-4">
          <AdminProfileSection />
        </TabsContent>
        <TabsContent value="security" className="mt-4">
          <AdminSecuritySection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
