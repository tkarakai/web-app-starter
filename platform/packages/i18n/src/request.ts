import { getRequestConfig } from "next-intl/server";

import { defaultLocale, type Locale, locales } from "./config";
import { loadMessages } from "./messages";

/**
 * next-intl request configuration.
 * Loads the requested locale's messages at runtime: platform and app namespaces
 * merged, with the app's overrides applied (see ./messages.ts).
 *
 * Usage: import this module from `i18n/request.ts` in each Next.js app
 * (required by next-intl's plugin / middleware).
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // Validate — fall back to the default if the app doesn't ship the requested locale
  if (!locale || !locales.includes(locale as Locale)) {
    locale = defaultLocale;
  }

  return {
    locale,
    messages: await loadMessages(locale as Locale),
  };
});
