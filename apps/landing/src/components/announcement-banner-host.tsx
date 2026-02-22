"use client";

import * as React from "react";

import { AnnouncementBanner } from "@repo/design-system";

const LOCAL_STORAGE_DISMISS_KEY = "announcementDismissedPermanentId";
const ANNOUNCEMENT_ENDPOINT_PATH = "/api/announcements/active";

function getConvexSiteUrlCandidates(): string[] {
  const fromEnv = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  const envCandidates = fromEnv ? [fromEnv] : [];

  if (process.env.NODE_ENV === "production") {
    return envCandidates;
  }

  return [
    ...new Set([
      ...envCandidates,
      "http://127.0.0.1:3211",
      "http://localhost:3211",
      "http://127.0.0.1:3210",
      "http://localhost:3210",
    ]),
  ];
}

type ActiveAnnouncement = {
  _id: string;
  name: string;
  bannerText: string;
  callToActionName?: string;
  callToActionUrl?: string;
  learnMoreName?: string;
  learnMoreContent?: string;
};

export function AnnouncementBannerHost() {
  const [announcement, setAnnouncement] = React.useState<ActiveAnnouncement | null>(
    null
  );
  const [dismissedId, setDismissedId] = React.useState<string | null>(null);
  const bannerContainerRef = React.useRef<HTMLDivElement | null>(null);
  const isVisible = Boolean(announcement && dismissedId !== announcement._id);

  React.useEffect(() => {
    let cancelled = false;
    const loadAnnouncement = async () => {
      for (const baseUrl of getConvexSiteUrlCandidates()) {
        try {
          const res = await fetch(`${baseUrl}${ANNOUNCEMENT_ENDPOINT_PATH}`, {
            cache: "no-store",
          });
          if (!res.ok) {
            continue;
          }
          const json = (await res.json()) as {
            announcement: ActiveAnnouncement | null;
          };
          if (!cancelled) {
            setAnnouncement(json.announcement ?? null);
          }
          return;
        } catch {
          // Try the next candidate URL.
        }
      }

      if (!cancelled) {
        setAnnouncement(null);
      }
    };

    void loadAnnouncement();
    const intervalId = window.setInterval(() => {
      void loadAnnouncement();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setDismissedId(window.localStorage.getItem(LOCAL_STORAGE_DISMISS_KEY));
    } catch {
      setDismissedId(null);
    }
  }, [announcement?._id]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const root = window.document.documentElement;

    if (!isVisible || !bannerContainerRef.current) {
      root.style.removeProperty("--announcement-banner-h");
      return;
    }
    const bannerElement = bannerContainerRef.current;

    const updateHeightVar = () => {
      const height = bannerElement.offsetHeight;
      root.style.setProperty("--announcement-banner-h", `${height}px`);
    };

    updateHeightVar();

    const resizeObserver =
      typeof window.ResizeObserver !== "undefined"
        ? new window.ResizeObserver(updateHeightVar)
        : null;
    resizeObserver?.observe(bannerElement);
    window.addEventListener("resize", updateHeightVar);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateHeightVar);
      root.style.removeProperty("--announcement-banner-h");
    };
  }, [isVisible, announcement?._id]);

  if (!announcement) return null;
  if (dismissedId === announcement._id) return null;

  return (
    <div
      ref={bannerContainerRef}
      className="fixed top-[var(--env-banner-h,0px)] left-0 right-0 z-[60]"
    >
      <AnnouncementBanner
        name={announcement.name}
        bannerText={announcement.bannerText}
        callToActionName={announcement.callToActionName}
        callToActionUrl={announcement.callToActionUrl}
        learnMoreName={announcement.learnMoreName}
        learnMoreContent={announcement.learnMoreContent}
        onDismiss={() => {
          try {
            window.localStorage.setItem(LOCAL_STORAGE_DISMISS_KEY, announcement._id);
          } catch {
            // ignore storage errors
          }
          setDismissedId(announcement._id);
        }}
      />
    </div>
  );
}
