"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@web-app-starter/design-system";
import { CreateOrganizationDialog } from "./create-organization-dialog";

/** Account access remains available when the user has no organization memberships. */
export function NoOrganization() {
  const t = useTranslations("organization");
  const [creating, setCreating] = useState(false);

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center" data-testid="no-organization">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h2 className="text-lg font-semibold text-foreground">{t("empty.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
      </div>
      <Button onClick={() => setCreating(true)}>{t("create.action")}</Button>
      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
    </section>
  );
}
