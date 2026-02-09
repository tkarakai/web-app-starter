"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";

import { LanguageSelector } from "@repo/design-patterns";
import { locales, localeMetadata, persistLocale, type Locale } from "@repo/i18n";

export function SiteHeader() {
  const locale = useLocale();
  const t = useTranslations("common");
  const tl = useTranslations("language");
  const pathname = usePathname();
  const router = useRouter();

  const localeOptions = locales.map((code) => ({
    code,
    nativeName: localeMetadata[code as Locale].nativeName,
    flag: localeMetadata[code as Locale].flag,
  }));

  const handleLocaleChange = (newLocale: string) => {
    persistLocale(newLocale);
    const segments = pathname.split("/");
    segments[1] = newLocale;
    router.push(segments.join("/") || `/${newLocale}`);
  };

  return (
    <header className="fixed top-0 z-50 flex w-full items-center justify-between px-6 py-4">
      <span className="text-sm font-semibold text-foreground">
        {t("appName")}
      </span>
      <LanguageSelector
        currentLocale={locale}
        locales={localeOptions}
        onSelect={handleLocaleChange}
        ariaLabel={tl("ariaLabel")}
      />
    </header>
  );
}
