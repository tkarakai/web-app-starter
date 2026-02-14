"use client";

import { Link } from "@repo/i18n/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@repo/design-system";
import { LocaleSwitcher } from "./locale-switcher";

interface ContentPageLayoutProps {
  title: string;
  notice?: string;
  children: React.ReactNode;
}

export function ContentPageLayout({
  title,
  notice,
  children,
}: ContentPageLayoutProps) {
  const t = useTranslations("common");

  return (
    <div className="min-h-screen flex flex-col">
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
      <main className="flex-1 pt-20">
        <div className="mx-auto flex max-w-3xl flex-col px-6 py-8">
          <Link
            href="/"
            className="mb-8 flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground w-fit"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToHome")}
          </Link>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {notice ? (
            <Alert className="mb-8 mt-8">
              <Info className="h-4 w-4" />
              <AlertTitle>{t("note")}</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-6 text-sm leading-relaxed text-muted-foreground pb-24">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
