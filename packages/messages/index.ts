/**
 * The app's own messages: a seam the platform's i18n loader reads
 * (`@web-app-starter/i18n`, `loadMessages`). App-owned; the platform never edits it.
 *
 * - `<locale>.json`: the app's namespaces (landing, legal, dashboard, the sample
 *   domain, ...). A namespace belongs to the app or to the platform, never both;
 *   `bun run check:i18n` fails on a clash.
 * - `overrides.json`: app wording for platform strings, keyed by locale, then by the
 *   platform's namespace path, e.g. `{ "en": { "auth": { "signIn": { "title": "Log in" } } } }`.
 *   Deep-merged over the platform's messages at load. `bun run check:i18n` flags an
 *   override whose platform key no longer exists (for example after an upgrade).
 *
 * Add a locale here when you add it to `i18n.locales` in `app.config.ts`.
 */
import overrides from "./overrides.json";

/** A message tree: nested namespaces with string leaves. */
export type AppMessages = { [key: string]: string | AppMessages };

/** Loaders for the app's message files, one per locale it has messages for. */
export const appMessages: Readonly<Record<string, () => Promise<AppMessages>>> = {
  en: () => import("./en.json").then((module) => module.default),
  cs: () => import("./cs.json").then((module) => module.default),
  de: () => import("./de.json").then((module) => module.default),
  es: () => import("./es.json").then((module) => module.default),
  fr: () => import("./fr.json").then((module) => module.default),
  it: () => import("./it.json").then((module) => module.default),
  hu: () => import("./hu.json").then((module) => module.default),
  nl: () => import("./nl.json").then((module) => module.default),
  pl: () => import("./pl.json").then((module) => module.default),
  pt: () => import("./pt.json").then((module) => module.default),
  ru: () => import("./ru.json").then((module) => module.default),
  zh: () => import("./zh.json").then((module) => module.default),
  ja: () => import("./ja.json").then((module) => module.default),
  ar: () => import("./ar.json").then((module) => module.default),
  he: () => import("./he.json").then((module) => module.default),
};

/** App overrides of platform strings, by locale. */
export const appOverrides: Readonly<Record<string, AppMessages>> = overrides;
