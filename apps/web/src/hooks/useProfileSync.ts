/* eslint-disable no-undef */
"use client";

import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { useLocale } from "next-intl";
import { api } from "@repo/backend";

const LOCALE_KEY = "NEXT_LOCALE";

/**
 * Sync user profile (locale) between Convex and localStorage.
 *
 * When authenticated:
 * - Reads Convex profile on mount
 * - If Convex has locale: overwrites localStorage
 * - If Convex has no locale BUT localStorage has one: syncs to Convex
 * - If neither has locale: sets Convex to current URL locale
 *
 * When unauthenticated:
 * - Does nothing (profile query returns null)
 *
 * Must be called in a client component that runs under AuthGuard
 * (where user is guaranteed to exist if profile syncing is needed).
 */
export function useProfileSync() {
  const currentLocale = useLocale();
  const profile = useQuery(api.userProfiles.get);
  const setLocale = useMutation(api.userProfiles.setLocale);

  useEffect(() => {
    // Wait for query to load
    if (profile === undefined) return;

    // Unauthenticated: no sync needed
    if (profile === null) return;

    // Authenticated: sync Convex ↔ localStorage
    const convexLocale = profile.locale;
    const localStorageLocale = (() => {
      try {
        return localStorage.getItem(LOCALE_KEY);
      } catch {
        return null;
      }
    })();

    // Case 1: Convex has locale → overwrite localStorage
    if (convexLocale) {
      if (localStorageLocale !== convexLocale) {
        try {
          localStorage.setItem(LOCALE_KEY, convexLocale);
        } catch {
          // Storage unavailable (incognito mode, quota exceeded, etc.)
        }
      }
      return;
    }

    // Case 2: Convex has no locale BUT localStorage does → sync to Convex
    if (localStorageLocale && localStorageLocale !== currentLocale) {
      setLocale({ locale: localStorageLocale });
      return;
    }

    // Case 3: Neither has locale → set Convex to current locale (from URL)
    if (!convexLocale && !localStorageLocale) {
      setLocale({ locale: currentLocale });
    }
  }, [profile, currentLocale, setLocale]);
}
