"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/design-system";

import { WaitlistSection } from "./waitlist-section";

const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "http://localhost:3210";
const WEB_APP_URL =
  process.env.NEXT_PUBLIC_WEB_APP_URL ?? "http://localhost:3001";

/** How often to retry when Convex is unreachable (ms). */
const RETRY_INTERVAL = 5_000;

type Status = "loading" | "unreachable" | "waitlist" | "ready";

/**
 * Client component that checks waitlist status on mount and renders
 * either the waitlist form or sign-up/sign-in buttons.
 *
 * When Convex is unreachable, hides all interactive elements and
 * polls every few seconds until the backend becomes available again.
 */
export function HeroCta() {
  const t = useTranslations("landing");
  const [status, setStatus] = React.useState<Status>("loading");

  React.useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function checkWaitlist() {
      try {
        const res = await fetch(`${CONVEX_SITE_URL}/api/waitlist/status`);
        const data = (await res.json()) as { enabled?: boolean };
        if (!cancelled) {
          setStatus(data.enabled === true ? "waitlist" : "ready");
        }
      } catch {
        if (!cancelled) {
          setStatus("unreachable");
          retryTimer = setTimeout(checkWaitlist, RETRY_INTERVAL);
        }
      }
    }

    checkWaitlist();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex h-10 gap-3">
        <div className="h-10 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-24 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  // Convex unreachable — hide everything; polling will restore UI automatically
  if (status === "unreachable") {
    return null;
  }

  if (status === "waitlist") {
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
