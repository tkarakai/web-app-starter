"use client";

import { errorCode } from "@web-app-starter/agentic/errors";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";

import { api } from "@repo/backend";
import { authClient } from "@web-app-starter/auth/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  toast,
} from "@web-app-starter/design-system";

import { SessionAccessGate } from "../components/session-access-gate";

/**
 * Delete your own user: it happens after the grace period the platform admin set, unless you
 * sign in and cancel. Asking signs you out everywhere. Refused while you are the last member or
 * owner of a billing organization that pays for other organizations.
 */
export function DeleteUserSection() {
  const t = useTranslations("userDeletion");
  const tc = useTranslations("common");
  const locale = useLocale();
  const graceDays = useQuery(api.platform.userDeletion.graceDays) ?? 14;
  const request = useMutation(api.platform.userDeletion.request);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await request({});
      await authClient.signOut();
      window.location.assign(`/${locale}/sign-in`);
    } catch (error) {
      const code = errorCode(error);
      toast.error(code === "BILLING_ORGANIZATION_IN_USE" ? t("blockedInUse")
        : code === "BILLING_OWNER_REQUIRED" ? t("blockedOwnerRequired")
        : code === "RECENT_AUTHENTICATION_REQUIRED" ? t("reauthenticate")
        : tc("error"));
      setBusy(false);
    }
  };

  return (
    <Card className="border-destructive/40" data-testid="delete-user">
      <CardHeader>
        <CardTitle className="text-base text-destructive">{t("title")}</CardTitle>
        <CardDescription>{t("description", { days: graceDays })}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 className="me-2 h-4 w-4" />
          {t("action")}
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent closeLabel={tc("close")}>
            <DialogHeader>
              <DialogTitle>{t("confirmTitle")}</DialogTitle>
              <DialogDescription>{t("confirmDescription", { days: graceDays })}</DialogDescription>
            </DialogHeader>
            {/* Asking needs recent authentication; the gate asks for it first when needed. */}
            <SessionAccessGate requireRecent embedded>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
                <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>{t("action")}</Button>
              </div>
            </SessionAccessGate>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
