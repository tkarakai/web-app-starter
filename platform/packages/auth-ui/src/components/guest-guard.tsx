"use client";

import * as React from "react";

import { authClient } from "@web-app-starter/auth/client";
import { onAuthBroadcast } from "../lib/auth-broadcast";

/**
 * Wraps unauthenticated pages (sign-in, sign-up).
 * Redirects to /dashboard when the user becomes authenticated,
 * e.g. after logging in on another tab.
 *
 * Uses a full page navigation (not Next.js router) so the Convex auth
 * provider remounts with a fresh server-issued token.
 */
export function GuestGuard({ children, getRedirectPath }: { children: React.ReactNode; getRedirectPath?: () => string }) {
  React.useEffect(() => {
    // Listen for auth events from other tabs (instant, no network call).
    const cleanupBroadcast = onAuthBroadcast(() => {
      window.location.replace(getRedirectPath?.() ?? "/dashboard");
    });

    // When the tab becomes visible, check if a session now exists (fallback).
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      const { data } = await authClient.getSession();
      if (data?.session) {
        window.location.replace(getRedirectPath?.() ?? "/dashboard");
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cleanupBroadcast();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [getRedirectPath]);

  return <>{children}</>;
}
