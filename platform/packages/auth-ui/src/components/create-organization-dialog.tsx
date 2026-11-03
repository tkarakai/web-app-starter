"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";

import { api } from "@repo/backend";
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

import { billingErrorKey, type PlanOption } from "../lib/billing";
import { PlanChoice, useSelectedPlan } from "./plan-fields";

/**
 * Create an organization a billing organization pays for (organizations mode): its owners and
 * admins pick a name and a plan; the creator becomes the owner and starts working in it.
 */
export function CreateOrganizationDialog({
  open,
  onOpenChange,
  onCreated,
  billingOrganizationId,
  billingName,
  plans,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs before the switch lands, e.g. to clear a selection from the previous organization. */
  onCreated?: () => void;
  billingOrganizationId: string;
  /** The paying organization, named in the dialog. */
  billingName: string;
  plans: PlanOption[];
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const create = useMutation(api.platform.billing.createOrganization);
  const { planId, plan, setPlanId } = useSelectedPlan(plans);
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !plan) return;
    setPending(true);
    try {
      const { organizationId } = await create({ billingOrganizationId, name: trimmed, planId });
      onCreated?.();
      await authClient.organization.setActive({ organizationId });
      toast.success(t("created", { name: trimmed }));
      setName("");
      onOpenChange(false);
    } catch (error) {
      toast.error(t(`errors.${billingErrorKey(error)}`));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createDescription", { billing: billingName })}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="space-y-2">
            <Label htmlFor="new-organization-name">{t("createNameLabel")}</Label>
            <Input
              id="new-organization-name"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </div>
          <PlanChoice plans={plans} value={planId} onChange={setPlanId} idPrefix="new-organization-plan" />
          <Button type="submit" className="w-full" disabled={pending || !name.trim() || !plan}>
            {pending ? tc("creating") : t("createAction")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
