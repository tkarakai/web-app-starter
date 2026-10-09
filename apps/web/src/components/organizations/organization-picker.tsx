"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Label } from "@web-app-starter/design-system";
import { useOrganizationSnapshot } from "@/hooks/use-personal-data";
import { selectOrganization, useOrganizationSelection } from "@/hooks/organization-selection";

export function OrganizationPicker() {
  const t = useTranslations("organizations");
  const id = useId();
  const { mine, userId } = useOrganizationSnapshot();
  const selected = useOrganizationSelection(userId ?? null);
  if (!userId || !mine || mine.contexts.length === 0 || (mine.contexts.length === 1 && (selected === null || selected === mine.contexts[0]?.organizationId))) return null;
  return <div className="space-y-1 px-2 py-2">
    <Label htmlFor={id} className="text-xs">{t("context")}</Label>
    <select id={id} className="w-full min-w-0 rounded-md border bg-background px-2 py-2 text-sm" value={selected ?? ""}
      onChange={event => { if (event.target.value) selectOrganization(userId, event.target.value); }}>
      <option value="" disabled>{t("choose")}</option>
      {selected && !mine.contexts.some(item => item.organizationId === selected) && <option value={selected} disabled>{t("unavailable")}</option>}
      {mine.contexts.map(item => <option key={item.organizationId} value={item.organizationId}>{item.name}{item.lifecycle !== "active" ? ` — ${t("unavailableShort")}` : ""}</option>)}
    </select>
  </div>;
}
