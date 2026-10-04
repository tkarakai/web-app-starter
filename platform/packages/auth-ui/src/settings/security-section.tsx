"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
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
} from "@web-app-starter/design-system";
import { ChangePasswordForm } from "./change-password-form";
import { PasskeySection } from "./passkey-section";
import { TwoFactorSection } from "./two-factor-section";
import { SessionAccessGate } from "../components/session-access-gate";
import { SessionsList } from "./sessions-list";

function normalizeTab(value: string | null): "password" | "2fa" | "passkeys" | "sessions" {
  if (value === "2fa" || value === "passkeys" || value === "sessions") return value;
  return "password";
}

export function SecuritySection() {
  const td = useTranslations("accountSecurity");
  const searchParams = useSearchParams();
  const [tab, setTab] = React.useState<"password" | "2fa" | "passkeys" | "sessions">(
    normalizeTab(searchParams.get("tab")),
  );

  const urlTab = searchParams.get("tab");
  const previousUrlTab = React.useRef(urlTab);
  React.useEffect(() => {
    // Activity reconnects effects; only navigation should replace local selection.
    if (previousUrlTab.current === urlTab) return;
    previousUrlTab.current = urlTab;
    setTab(normalizeTab(urlTab));
  }, [urlTab]);

  const enforce = searchParams.get("enforce");

  return (
    <SessionAccessGate requireRecent><Card>
      <CardHeader>
        <CardTitle>{td("security")}</CardTitle>
      </CardHeader>
      <CardContent>
        {enforce ? (
          <div className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
            {enforce === "passkey"
              ? td("passkeys.requiredNotice")
              : td("twoFactor.requiredNotice")}
          </div>
        ) : null}
        <Tabs value={tab} onValueChange={(value) => setTab(normalizeTab(value))}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="password">{td("changePassword.title")}</TabsTrigger>
            <TabsTrigger value="2fa">{td("twoFactor.title")}</TabsTrigger>
            <TabsTrigger value="passkeys">{td("passkeys.title")}</TabsTrigger>
            <TabsTrigger value="sessions">{td("sessions.title")}</TabsTrigger>
          </TabsList>
          <TabsContent value="password" className="mt-4">
            <ChangePasswordForm />
          </TabsContent>
          <TabsContent value="2fa" className="mt-4">
            <TwoFactorSection />
          </TabsContent>
          <TabsContent value="passkeys" className="mt-4">
            <PasskeySection />
          </TabsContent>
          <TabsContent value="sessions" className="mt-4">
            <SessionsList />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card></SessionAccessGate>
  );
}
