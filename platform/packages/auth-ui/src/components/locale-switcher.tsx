"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useMutation } from "convex/react";

import { LanguageSelector } from "@web-app-starter/design-patterns";
import { useNetworkStatus } from "@web-app-starter/design-system";
import { locales, localeMetadata, navigateToLocalePath, persistLocale, type Locale } from "@web-app-starter/i18n";
import { api } from "@repo/backend";
import { useAuthUser } from "./auth-guard";

interface LocaleSwitcherProps {
  className?: string;
  variant?: "standalone" | "submenu";
}

export function LocaleSwitcher({ className, variant }: LocaleSwitcherProps) {
  const locale = useLocale();
  const tl = useTranslations("language");
  const pathname = usePathname();
  const user = useAuthUser();
  const setLocale = useMutation(api.platform.userProfiles.setLocale);
  const isOnline = useNetworkStatus();
  const [changingLocale, setChangingLocale] = useState(false);

  const localeOptions = locales.map((code) => ({
    code,
    nativeName: localeMetadata[code as Locale].nativeName,
    flag: localeMetadata[code as Locale].flag,
  }));

  const handleLocaleChange = async (newLocale: string) => {
    if (newLocale === locale || changingLocale) return;
    setChangingLocale(true);
    // Save to localStorage + cookie (immediate, for next-intl middleware)
    persistLocale(newLocale);

    // Save to Convex if authenticated, and let it finish before the page reloads: the Convex
    // client answers a reload during an unfinished mutation with a "Leave site?" prompt,
    // which leaves the page in the old language. Failure is fine; the cookie still applies.
    if (user) await setLocale({ locale: newLocale }).catch(() => {});

    // Navigate to new locale path, preserving query parameters (e.g. invitation token)
    const segments = pathname.split("/");
    segments[1] = newLocale;
    const newPath = segments.join("/") || `/${newLocale}`;
    const search = window.location.search;
    navigateToLocalePath(`${newPath}${search}`);
  };

  return (
    <LanguageSelector
      currentLocale={locale}
      locales={localeOptions}
      onSelect={(newLocale) => void handleLocaleChange(newLocale)}
      ariaLabel={tl("ariaLabel")}
      className={className}
      variant={variant}
      disabled={!isOnline || changingLocale}
    />
  );
}
