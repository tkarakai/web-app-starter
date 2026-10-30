"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { authClient } from "@web-app-starter/auth/client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from "@web-app-starter/design-system";

import { organizationErrorKey, organizationSlug } from "../lib/organization";

/** Create an organization; Better Auth makes the creator its owner and switches to it. */
export function CreateOrganizationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs before the switch lands, e.g. to clear a selection from the previous organization. */
  onCreated?: () => void;
}) {
  const t = useTranslations("organization");
  const tc = useTranslations("common");
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      onCreated?.();
      const result = await authClient.organization.create({ name: trimmed, slug: organizationSlug(trimmed) });
      if (result.error) {
        toast.error(t(`errors.${organizationErrorKey(result.error)}`));
        return;
      }
      toast.success(t("create.created", { name: trimmed }));
      setName("");
      onOpenChange(false);
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="new-organization-name">{t("create.nameLabel")}</Label>
            <Input
              id="new-organization-name"
              placeholder={t("create.namePlaceholder")}
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending || !name.trim()}>
            {pending ? tc("creating") : t("create.action")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
