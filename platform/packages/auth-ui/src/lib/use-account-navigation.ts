"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { accountPageHref, accountReturnPath } from "./account-navigation";

/** Account screens temporarily leave the app workspace and close back to it in the current locale. */
export function useAccountNavigation() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const locale = useLocale();
  return {
    settingsHref: accountPageHref("settings", pathname, search.toString()),
    organizationHref: accountPageHref("organization", pathname, search.toString()),
    open: (page: "settings" | "organization") => router.push(`/${locale}${accountPageHref(
      page, window.location.pathname, window.location.search.slice(1), window.location.hash,
    )}`),
    close: () => router.replace(`/${locale}${accountReturnPath(search.get("returnTo"))}`),
  };
}
