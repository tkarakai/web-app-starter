"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@repo/backend";
import { SecuritySection as PersonalSecuritySection, SessionAccessGate, ChangePasswordForm, PasskeySection, SessionsList, OrganizationFactorReplacement } from "@web-app-starter/auth-ui";
import { Card, CardHeader, CardTitle, CardContent, Tabs, TabsList, TabsTrigger, TabsContent } from "@web-app-starter/design-system";
import { useOrganizationSnapshot } from "@/hooks/use-personal-data";
import { useSafeQuery } from "@/hooks/use-safe-query";
import { OrganizationFeedback } from "@/components/organizations/organization-feedback";

export function SecuritySection() {
  const t = useTranslations("accountSecurity");
  const snapshot = useOrganizationSnapshot();
  const status = useSafeQuery(api.platform.sessionAssurance.status, {});
  const [tab, setTab] = useState("password");
  const organizationAdmin = status.data?.securityScope === "admin" || snapshot.mine?.contexts.some(item => item.experience === "collaborative" && item.role === "org-admin");
  if (status.error) return <OrganizationFeedback error={status.error} onRetry={() => window.location.reload()} />;
  if (!organizationAdmin || !status.data?.hasTotp) return <PersonalSecuritySection />;
  return <SessionAccessGate requireRecent><Card><CardHeader><CardTitle>{t("security")}</CardTitle></CardHeader><CardContent>
    <Tabs value={tab} onValueChange={setTab}><TabsList className="w-full justify-start overflow-x-auto">
      <TabsTrigger value="password">{t("changePassword.title")}</TabsTrigger><TabsTrigger value="2fa">{t("twoFactor.title")}</TabsTrigger><TabsTrigger value="passkeys">{t("passkeys.title")}</TabsTrigger><TabsTrigger value="sessions">{t("sessions.title")}</TabsTrigger>
    </TabsList><TabsContent value="password" className="mt-4"><ChangePasswordForm /></TabsContent><TabsContent value="2fa" className="mt-4"><OrganizationFactorReplacement /></TabsContent><TabsContent value="passkeys" className="mt-4"><PasskeySection /></TabsContent><TabsContent value="sessions" className="mt-4"><SessionsList /></TabsContent></Tabs>
  </CardContent></Card></SessionAccessGate>;
}
