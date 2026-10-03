"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button, Card, CardContent, CardDescription, CardTitle } from "@web-app-starter/design-system";

import { WaitlistSection } from "./waitlist-section";
import { useOnboardingStatus } from "./use-onboarding-status";
import { appConfig } from "@web-app-starter/app-config";

const WEB_APP_URL = process.env.NEXT_PUBLIC_WEB_APP_URL;
if (!WEB_APP_URL) {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_WEB_APP_URL");
}
/** Optional links offered while the backend is unreachable; hidden when unset. */
const BOOK_DEMO_URL = process.env.NEXT_PUBLIC_BOOK_DEMO_URL;
const CONTACT_URL = process.env.NEXT_PUBLIC_CONTACT_URL;

/**
 * Client component that checks onboarding mode on mount and renders one of:
 * waitlist form, sign-up + sign-in, or sign-in only.
 *
 * When Convex is unreachable, shows a fallback card (sign in, plus optional
 * book-demo and contact links) instead of onboarding, and retries
 * with exponential backoff (capped at 60 s, max 10 attempts). Retries
 * pause while the tab is hidden and resume when it becomes visible.
 */
export function HeroCta() {
  const t = useTranslations("landing");
  const status = useOnboardingStatus();
  const locale = useLocale();
  const webUrl = WEB_APP_URL!.replace(/\/$/, "");

  if (status === "loading") {
    return (
      <div className="flex h-10 gap-3">
        <div className="h-10 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-24 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  // Convex unreachable — offer what still works; polling restores the UI automatically
  if (status === "unreachable") {
    return (
      <Card className="w-full max-w-xl border-border/70 bg-card/85 shadow-xl shadow-primary/10">
        <CardContent className="space-y-4 p-6 text-left">
          <div className="space-y-1">
            <CardTitle className="text-base">{t("fallback.title")}</CardTitle>
            <CardDescription>{t("fallback.description")}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-3">
            {BOOK_DEMO_URL ? (
              <Button asChild>
                <a href={BOOK_DEMO_URL} target="_blank" rel="noreferrer">
                  {t("fallback.bookDemo")}
                </a>
              </Button>
            ) : null}
            {CONTACT_URL ? (
              <Button variant="outline" asChild>
                <a href={CONTACT_URL}>{t("fallback.contact")}</a>
              </Button>
            ) : null}
            <Button variant={BOOK_DEMO_URL || CONTACT_URL ? "ghost" : "default"} asChild>
              <a href={`${webUrl}/${locale}/sign-in`}>{t("signIn")}</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "waitlist" && appConfig.features.waitlist) {
    return <WaitlistSection />;
  }

  if (status === "signup") {
    return (
      <div className="flex gap-3">
        <Button asChild>
          <a href={`${webUrl}/${locale}/sign-up`}>{t("getStarted")}</a>
        </Button>
        <Button variant="outline" asChild>
          <a href={`${webUrl}/${locale}/sign-in`}>{t("signIn")}</a>
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" asChild>
      <a href={`${webUrl}/${locale}/sign-in`}>{t("signIn")}</a>
    </Button>
  );
}
