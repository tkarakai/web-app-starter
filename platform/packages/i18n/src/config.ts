import { appConfig } from "@web-app-starter/app-config";

/**
 * Every locale the platform translates its own strings into (platform/packages/i18n/messages).
 * Apps choose which of them they ship with `i18n.locales` in app.config.ts.
 */
export const allLocales = [
  "en", "cs", "de", "es", "fr", "it", "hu", "nl", "pl",
  "pt", "ru", "zh", "ja", "ar", "he",
] as const;
export type Locale = (typeof allLocales)[number];

export const defaultLocale: Locale = "en";

/** Check a locale list against the supported set; throws naming any unknown locale. */
export function selectLocales(requested: readonly string[]): readonly Locale[] {
  const unknown = requested.filter((locale) => !(allLocales as readonly string[]).includes(locale));
  if (unknown.length > 0) {
    throw new Error(
      `app.config.ts i18n.locales: unsupported locale(s) ${unknown.join(", ")}; supported: ${allLocales.join(", ")}`,
    );
  }
  return requested as readonly Locale[];
}

/** The locales this app ships: `i18n.locales` from app.config.ts, in that order. */
export const locales: readonly Locale[] = selectLocales(appConfig.i18n.locales);

/** Metadata for each locale used in the language selector UI. */
export const localeMetadata: Record<
  Locale,
  { name: string; nativeName: string; dir: "ltr" | "rtl"; flag: string }
> = {
  en: { name: "English", nativeName: "English", dir: "ltr", flag: "🇺🇸" },
  cs: { name: "Czech", nativeName: "Čeština", dir: "ltr", flag: "🇨🇿" },
  de: { name: "German", nativeName: "Deutsch", dir: "ltr", flag: "🇩🇪" },
  es: { name: "Spanish", nativeName: "Español", dir: "ltr", flag: "🇪🇸" },
  fr: { name: "French", nativeName: "Français", dir: "ltr", flag: "🇫🇷" },
  it: { name: "Italian", nativeName: "Italiano", dir: "ltr", flag: "🇮🇹" },
  hu: { name: "Hungarian", nativeName: "Magyar", dir: "ltr", flag: "🇭🇺" },
  nl: { name: "Dutch", nativeName: "Nederlands", dir: "ltr", flag: "🇳🇱" },
  pl: { name: "Polish", nativeName: "Polski", dir: "ltr", flag: "🇵🇱" },
  pt: { name: "Portuguese", nativeName: "Português", dir: "ltr", flag: "🇧🇷" },
  ru: { name: "Russian", nativeName: "Русский", dir: "ltr", flag: "🇷🇺" },
  zh: { name: "Chinese", nativeName: "中文", dir: "ltr", flag: "🇨🇳" },
  ja: { name: "Japanese", nativeName: "日本語", dir: "ltr", flag: "🇯🇵" },
  ar: { name: "Arabic", nativeName: "العربية", dir: "rtl", flag: "🇸🇦" },
  he: { name: "Hebrew", nativeName: "עברית", dir: "rtl", flag: "🇮🇱" },
};

const rtlLocales = new Set<string>(["ar", "he", "fa", "ur"]);

/** Returns `"rtl"` for right-to-left locales, `"ltr"` otherwise. */
export function getLocaleDirection(locale: string): "ltr" | "rtl" {
  return rtlLocales.has(locale) ? "rtl" : "ltr";
}
