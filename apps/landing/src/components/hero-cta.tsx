"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, CardDescription, CardTitle } from "@web-app-starter/design-system";

import { WaitlistSection } from "./waitlist-section";

const CONVEX_SITE_URL = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
if (!CONVEX_SITE_URL) {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_CONVEX_SITE_URL");
}
const WEB_APP_URL = process.env.NEXT_PUBLIC_WEB_APP_URL;
if (!WEB_APP_URL) {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_WEB_APP_URL");
}
/** Optional links offered while the backend is unreachable; hidden when unset. */
const BOOK_DEMO_URL = process.env.NEXT_PUBLIC_BOOK_DEMO_URL;
const CONTACT_URL = process.env.NEXT_PUBLIC_CONTACT_URL;

/** Initial retry delay (ms). */
const RETRY_BASE = 5_000;
/** Maximum retry delay (ms). */
const RETRY_MAX = 60_000;
/** Stop retrying after this many consecutive failures. */
const MAX_RETRIES = 10;

type Status = "loading" | "unreachable" | "waitlist" | "signup" | "closed";

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
  const [status, setStatus] = React.useState<Status>("loading");

  React.useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    async function checkWaitlist() {
      try {
        const res = await fetch(`${CONVEX_SITE_URL}/api/waitlist/status`);
        const data = (await res.json()) as {
          onboardingType?:
            | "inviteOnly"
            | "publicWaitlist"
            | "publicSignup"
            | "none"
            | "waitlist"
            | "signup";
          waitlistEnabled?: boolean;
          signupEnabled?: boolean;
          enabled?: boolean;
        };

        const nextStatus: Status =
          data.onboardingType === "publicWaitlist" ||
          data.onboardingType === "waitlist" ||
          data.waitlistEnabled === true ||
          data.enabled === true
            ? "waitlist"
            : data.onboardingType === "publicSignup" ||
              data.onboardingType === "signup" ||
              data.signupEnabled === true
            ? "signup"
            : "closed";

        if (!cancelled) {
          attempt = 0;
          setStatus(nextStatus);
        }
      } catch {
        if (!cancelled) {
          setStatus("unreachable");
          if (attempt < MAX_RETRIES) {
            const delay = Math.min(RETRY_BASE * 2 ** attempt, RETRY_MAX);
            attempt++;
            retryTimer = setTimeout(checkWaitlist, delay);
          }
        }
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && status === "unreachable") {
        clearTimeout(retryTimer);
        attempt = 0;
        checkWaitlist();
      } else if (document.visibilityState === "hidden") {
        clearTimeout(retryTimer);
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    checkWaitlist();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [status]);

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
              <a href={`${WEB_APP_URL}/sign-in`}>{t("signIn")}</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "waitlist") {
    return <WaitlistSection />;
  }

  if (status === "signup") {
    return (
      <div className="flex gap-3">
        <Button asChild>
          <a href={`${WEB_APP_URL}/sign-up`}>{t("getStarted")}</a>
        </Button>
        <Button variant="outline" asChild>
          <a href={`${WEB_APP_URL}/sign-in`}>{t("signIn")}</a>
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" asChild>
      <a href={`${WEB_APP_URL}/sign-in`}>{t("signIn")}</a>
    </Button>
  );
}
