"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@web-app-starter/i18n/navigation";
import { readOrganizationInvitation } from "./invitation-state";

/** Resume links never contain the capability; it remains in this tab's session storage. */
export function InvitationResume() {
  const pathname = usePathname(); const t = useTranslations("organizations");
  const [pending, setPending] = useState(false);
  useEffect(() => { setPending(Boolean(readOrganizationInvitation())); }, [pathname]);
  if (!pending || pathname.includes("/organization-invitation")) return null;
  return <div className="fixed inset-x-4 bottom-4 z-50 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-lg border bg-background px-4 py-3 text-center text-sm shadow-lg"><Link className="font-medium underline underline-offset-4" href="/organization-invitation">{t("resumeInvitation")}</Link></div>;
}
