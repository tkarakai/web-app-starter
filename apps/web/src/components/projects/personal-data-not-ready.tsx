"use client";

import { useTranslations } from "next-intl";

/** Keep unavailable data distinct from an authorized empty project/task/file list. */
export function PersonalDataNotReady({ state }: { state: "loading" | "unavailable" }) {
  const t = useTranslations("common");
  return <div role="status" aria-live="polite" data-personal-data-state={state} className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
    {t(state === "loading" ? "loading" : "error")}
  </div>;
}
