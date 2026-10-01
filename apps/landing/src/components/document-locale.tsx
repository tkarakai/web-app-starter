"use client";

import { useLayoutEffect } from "react";

const FONT_CLASSES: Record<string, string> = {
  ar: "font-arabic",
  he: "font-hebrew",
};

/** Keep document attributes in sync when navigating between locales on the client. */
export function DocumentLocale({ lang, dir }: { lang: string; dir: string }) {
  useLayoutEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = dir;

    // Apply locale-specific font class (Arabic → font-arabic, Hebrew → font-hebrew).
    // The default Latin font (Raleway via --font-sans) is applied via the root layout class.
    const fontClass = FONT_CLASSES[lang];
    for (const cls of Object.values(FONT_CLASSES)) {
      el.classList.remove(cls);
    }
    if (fontClass) {
      el.classList.add(fontClass);
    }
  }, [lang, dir]);

  return null;
}
