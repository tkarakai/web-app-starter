"use client";

import { useTranslations } from "next-intl";
import { Link } from "@repo/i18n/navigation";

import { LocaleSwitcher } from "./locale-switcher";

export function SiteHeader() {
  const t = useTranslations("common");

  return (
    <header className="fixed top-[var(--env-banner-h,0px)] z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="text-sm font-semibold text-foreground transition-colors hover:text-muted-foreground"
        >
          {t("appName")}
        </Link>
        <LocaleSwitcher />
      </div>
    </header>
  );
}
