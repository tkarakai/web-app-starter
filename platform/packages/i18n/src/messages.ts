import { appMessages, appOverrides } from "@repo/messages";

import { defaultLocale, type Locale } from "./config";
import { mergeMessages, type Messages } from "./merge";

/** Loaders for the platform's message files, one per supported locale. */
export const platformMessages: Readonly<Record<Locale, () => Promise<Messages>>> = {
  en: () => import("../messages/en.json").then((module) => module.default),
  cs: () => import("../messages/cs.json").then((module) => module.default),
  de: () => import("../messages/de.json").then((module) => module.default),
  es: () => import("../messages/es.json").then((module) => module.default),
  fr: () => import("../messages/fr.json").then((module) => module.default),
  it: () => import("../messages/it.json").then((module) => module.default),
  hu: () => import("../messages/hu.json").then((module) => module.default),
  nl: () => import("../messages/nl.json").then((module) => module.default),
  pl: () => import("../messages/pl.json").then((module) => module.default),
  pt: () => import("../messages/pt.json").then((module) => module.default),
  ru: () => import("../messages/ru.json").then((module) => module.default),
  zh: () => import("../messages/zh.json").then((module) => module.default),
  ja: () => import("../messages/ja.json").then((module) => module.default),
  ar: () => import("../messages/ar.json").then((module) => module.default),
  he: () => import("../messages/he.json").then((module) => module.default),
};

/**
 * Every message for one locale: the platform's namespaces, the app's
 * (`@repo/messages`), and the app's overrides of platform strings. A locale the app
 * has no messages for falls back to the default locale's app messages.
 */
export async function loadMessages(locale: Locale): Promise<Messages> {
  const loadApp = appMessages[locale] ?? appMessages[defaultLocale];
  const [platform, app] = await Promise.all([
    platformMessages[locale](),
    loadApp ? loadApp() : Promise.resolve({}),
  ]);
  return mergeMessages(platform, app, appOverrides[locale] ?? {});
}
