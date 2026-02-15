"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/design-system";

import { WaitlistSection } from "./waitlist-section";

const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "http://localhost:3210";
const WEB_APP_URL =
  process.env.NEXT_PUBLIC_WEB_APP_URL ?? "http://localhost:3001";

/**
 * Client component that checks waitlist status on mount and renders
 * either the waitlist form or sign-up/sign-in buttons.
 */
export function HeroCta() {
  const t = useTranslations("landing");
  const [waitlistEnabled, setWaitlistEnabled] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function checkWaitlist() {
      try {
        const res = await fetch(`${CONVEX_SITE_URL}/api/waitlist/status`);
        const data = (await res.json()) as { enabled?: boolean };
        if (!cancelled) {
          setWaitlistEnabled(data.enabled === true);
        }
      } catch {
        if (!cancelled) {
          setWaitlistEnabled(false);
        }
      }
    }

    checkWaitlist();
    return () => { cancelled = true; };
  }, []);

  // Loading state — render invisible placeholder to avoid layout shift
  if (waitlistEnabled === null) {
    return (
      <div className="flex h-10 gap-3">
        <div className="h-10 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-24 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (waitlistEnabled) {
    return <WaitlistSection />;
  }

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
