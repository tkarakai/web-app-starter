"use client";

import { Link } from "@repo/i18n/navigation";

import { SiteHeader as SharedSiteHeader } from "@repo/design-patterns";
import { LocaleSwitcher } from "./locale-switcher";
import { appConfig } from "@repo/app-config";

export function SiteHeader() {

  return (
    <SharedSiteHeader
      appName={appConfig.identity.productName}
      linkAs={Link}
      actions={<LocaleSwitcher />}
    />
  );
}
