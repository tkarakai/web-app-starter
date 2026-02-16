"use client";

import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/design-system";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { TwoFactorSection } from "@/components/settings/two-factor-section";
import { SessionsList } from "@/components/settings/sessions-list";

export function SecuritySection() {
  const td = useTranslations("dashboard");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{td("security")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="password">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="password">{td("changePassword.title")}</TabsTrigger>
            <TabsTrigger value="2fa">{td("twoFactor.title")}</TabsTrigger>
            <TabsTrigger value="sessions">{td("sessions.title")}</TabsTrigger>
          </TabsList>
          <TabsContent value="password" className="mt-4">
            <ChangePasswordForm />
          </TabsContent>
          <TabsContent value="2fa" className="mt-4">
            <TwoFactorSection />
          </TabsContent>
          <TabsContent value="sessions" className="mt-4">
            <SessionsList />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
