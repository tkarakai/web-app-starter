"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@web-app-starter/design-system";
import { useAccountNavigation } from "../lib/use-account-navigation";

/** Close a Settings or Organization page without trapping the user in account-page history. */
export function AccountPageCloseButton() {
  const t = useTranslations("common");
  const navigation = useAccountNavigation();
  return (
    <Button className="ms-auto shrink-0" variant="ghost" size="icon" aria-label={t("close")} title={t("close")} onClick={navigation.close}>
      <X className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
