"use client";

import { Link } from "@web-app-starter/i18n/navigation";

import { SiteHeader as SharedSiteHeader } from "@web-app-starter/design-patterns";
import { LocaleSwitcher } from "./locale-switcher";
import { appConfig } from "@web-app-starter/app-config";

export function SiteHeader() {

  return (
    <SharedSiteHeader
      appName={appConfig.identity.productName}
      linkAs={Link}
      actions={<LocaleSwitcher />}
      className="top-[calc(var(--env-banner-h,0px)+var(--announcement-banner-h,0px))]"
    />
  );
}
