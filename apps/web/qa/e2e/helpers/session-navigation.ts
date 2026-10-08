import type { Locator, Page } from "@playwright/test";
import type { Locale } from "@web-app-starter/i18n";
import { createTranslator } from "next-intl";
import { loadE2EMessages } from "./locale-messages";

/** Read the active back-control label, including adopted app overrides. */
export function sessionBackLabel(locale: Locale): string {
  const t = createTranslator({
    locale,
    messages: loadE2EMessages(locale),
  });
  return t("accountSecurity.sessions.backToDashboard");
}

/** Select the sessions page's back control independently of the product name. */
export function sessionBackButton(page: Page, locale: Locale): Locator {
  return page.getByRole("button", { name: sessionBackLabel(locale), exact: true });
}
