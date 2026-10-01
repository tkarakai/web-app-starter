"use client";

import { useLayoutEffect } from "react";

/** Keep document attributes in sync when navigating between locales on the client. */
export function DocumentLocale({ lang, dir }: { lang: string; dir: string }) {
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);
  return null;
}
