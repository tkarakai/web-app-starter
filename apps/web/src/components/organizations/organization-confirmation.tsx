"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@web-app-starter/design-system";
import { OrganizationFeedback } from "./organization-feedback";

export function OrganizationConfirmation({ open, title, description, children, busy, error, onOpenChange, onConfirm }: {
  open: boolean; title: string; description: string; children?: ReactNode; busy: boolean; error: unknown;
  onOpenChange: (open: boolean) => void; onConfirm: () => void;
}) {
  const t = useTranslations("organizations");
  return <AlertDialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <AlertDialogContent data-agent-sensitive><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      {children}{Boolean(error) && <OrganizationFeedback error={error} />}
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); onConfirm(); }}>{t("confirm")}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
