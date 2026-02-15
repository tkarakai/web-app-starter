"use client";

import { useTranslations } from "next-intl";

import { SiteHeader as SharedSiteHeader } from "@repo/design-patterns";
import { LocaleSwitcher } from "./locale-switcher";

export function SiteHeader() {
  const t = useTranslations("common");

  return (
    <SharedSiteHeader appName={t("appName")} actions={<LocaleSwitcher />} />
  );
}
