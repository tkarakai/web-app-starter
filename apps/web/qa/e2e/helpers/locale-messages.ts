import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultLocale, mergeMessages, type Locale, type Messages } from "@web-app-starter/i18n";
import type englishMessages from "@web-app-starter/i18n/messages/en.json";

/** Load merged catalogues in Playwright's Node process, including adopted app overrides. */
export function loadE2EMessages(locale: Locale): typeof englishMessages {
  // Dynamic JSON imports in the platform loader rely on the app bundler.
  const root = resolve(__dirname, "../../../../..");
  const read = (file: string): Messages =>
    JSON.parse(readFileSync(resolve(root, file), "utf8")) as Messages;
  const appFile = `packages/messages/${locale}.json`;
  const overrides = read("packages/messages/overrides.json")[locale];
  return mergeMessages(
    read(`platform/packages/i18n/messages/${locale}.json`),
    read(existsSync(resolve(root, appFile)) ? appFile : `packages/messages/${defaultLocale}.json`),
    typeof overrides === "object" ? overrides : {},
  ) as typeof englishMessages;
}
