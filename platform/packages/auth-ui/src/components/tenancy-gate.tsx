"use client";

import * as React from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";

import { api } from "@repo/backend";
import { authClient } from "@web-app-starter/auth/client";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, toast } from "@web-app-starter/design-system";

import { billingErrorKey, type PaymentMethod, type PlanOption, type TenancyMode } from "../lib/billing";
import { PaymentMethodField, PlanChoice, useSelectedPlan } from "./plan-fields";

/**
 * Keeps the app closed while the server does (billingAccess.ts): a scheduled deletion of the
 * user, then the sign-up plan picker. Every organization-scoped API refuses on its own; this
 * only shows the way out.
 */
export function TenancyGate({ children }: { children: React.ReactNode }) {
  const status = useQuery(api.platform.billing.myStatus);
  if (status?.deletion) return <DeletionScheduled deleteAt={status.deletion.deleteAt} blockedReason={status.deletion.blockedReason} />;
  if (status?.planChoice) return <PlanPicker plans={status.planChoice.plans} mode={status.mode} />;
  return <>{children}</>;
}

function DeletionScheduled({ deleteAt, blockedReason }: { deleteAt: number; blockedReason: string | null }) {
  const t = useTranslations("userDeletion");
  const format = useFormatter();
  const locale = useLocale();
  const cancel = useMutation(api.platform.userDeletion.cancel);
  const [busy, setBusy] = React.useState(false);

  const keep = async () => {
    setBusy(true);
    try {
      await cancel({});
      toast.success(t("canceled"));
    } catch {
      toast.error(t("reauthenticate"));
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    setBusy(true);
    await authClient.signOut();
    window.location.assign(`/${locale}/sign-in`);
  };

  const blocked = blockedReason === "BILLING_ORGANIZATION_IN_USE" ? t("blockedInUse")
    : blockedReason === "BILLING_OWNER_REQUIRED" ? t("blockedOwnerRequired") : null;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-lg" data-testid="user-deletion-scheduled">
        <CardHeader>
          <CardTitle>{blocked ? t("blockedTitle") : t("scheduledTitle")}</CardTitle>
          <CardDescription>{blocked ?? t("scheduledDescription", { date: format.dateTime(deleteAt, { dateStyle: "long" }) })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => void keep()} disabled={busy}>{t("cancel")}</Button>
          <Button variant="outline" onClick={() => void leave()} disabled={busy}>{t("continue")}</Button>
        </CardContent>
      </Card>
    </main>
  );
}

function PlanPicker({ plans, mode }: { plans: PlanOption[]; mode: TenancyMode | null }) {
  const t = useTranslations("billing");
  const choose = useMutation(api.platform.billing.choosePlan);
  const { planId, plan, setPlanId } = useSelectedPlan(plans);
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod | "">("");
  const [billingName, setBillingName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const paid = plan ? !plan.isFreeForever : false;
  const needsName = paid && mode === "organizations";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!plan) return;
    if (paid && !paymentMethod) return toast.error(t("errors.paymentMethodRequired"));
    if (needsName && !billingName.trim()) return toast.error(t("errors.nameRequired"));
    setBusy(true);
    try {
      await choose({
        planId,
        ...(paid && paymentMethod ? { paymentMethod } : {}),
        ...(needsName ? { billingOrganizationName: billingName.trim() } : {}),
      });
    } catch (error) {
      toast.error(t(`errors.${billingErrorKey(error)}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-lg" data-testid="plan-picker">
        <CardHeader>
          <CardTitle>{t("pickerTitle")}</CardTitle>
          <CardDescription>{t("pickerDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <PlanChoice plans={plans} value={planId} onChange={setPlanId} idPrefix="picker-plan" />
            {paid && <PaymentMethodField id="picker-payment" value={paymentMethod} onChange={setPaymentMethod} />}
            {needsName && (
              <div className="grid gap-2">
                <Label htmlFor="picker-billing-name">{t("payerName")}</Label>
                <Input id="picker-billing-name" value={billingName} maxLength={100} onChange={(event) => setBillingName(event.target.value)} />
              </div>
            )}
            <Button type="submit" disabled={busy || !plan}>{t("pickerContinue")}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
