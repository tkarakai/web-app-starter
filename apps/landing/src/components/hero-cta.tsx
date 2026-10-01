"use client";

import { useTranslations } from "next-intl";
import { Button } from "@web-app-starter/design-system";

const WEB_APP_URL = process.env.NEXT_PUBLIC_WEB_APP_URL;
if (!WEB_APP_URL) throw new Error("Missing required environment variable: NEXT_PUBLIC_WEB_APP_URL");

/** Marketing hands off to web, which owns the authoritative onboarding decision. */
export function HeroCta() {
  const t = useTranslations("landing");
  return (
    <div className="flex gap-3">
      <Button asChild><a href={`${WEB_APP_URL}/sign-up`}>{t("getStarted")}</a></Button>
      <Button variant="outline" asChild><a href={`${WEB_APP_URL}/sign-in`}>{t("signIn")}</a></Button>
    </div>
  );
}
