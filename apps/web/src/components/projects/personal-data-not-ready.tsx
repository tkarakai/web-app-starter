"use client";

import { useTranslations } from "next-intl";
import { Link } from "@web-app-starter/i18n/navigation";
import { Button } from "@web-app-starter/design-system";

/** Keep unavailable data distinct from an authorized empty project/task/file list. */
export function PersonalDataNotReady({ state }: { state: "loading" | "unavailable" }) {
  const t = useTranslations("common");
  const organization = useTranslations("organizations");
  return <div role="status" aria-live="polite" data-personal-data-state={state} className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
    <p>{t(state === "loading" ? "loading" : "error")}</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => window.location.reload()}>{organization("retry")}</Button><Link className="inline-flex items-center rounded-md border px-3 py-2 text-foreground" href="/dashboard/organization">{organization("title")}</Link></div>
  </div>;
}
