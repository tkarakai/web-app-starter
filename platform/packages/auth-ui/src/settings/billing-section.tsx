"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";

import { api } from "@repo/backend";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  toast,
} from "@web-app-starter/design-system";

import { billingErrorKey, type PaymentMethod, type PlanOption } from "../lib/billing";
import { PaymentMethodField, PlanChoice, usePlanPrice, useSelectedPlan } from "../components/plan-fields";
import { CreateOrganizationDialog } from "../components/create-organization-dialog";

const NEW_PAYER = "new";

function useRun() {
  const t = useTranslations("billing");
  const [busy, setBusy] = React.useState(false);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(t(`errors.${billingErrorKey(error)}`));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/**
 * The active organization's plan and payer, and what the caller may change: the plan (the
 * payer's owners and admins), an upgrade of a free organization without a payer, and, when the
 * active organization is a billing organization, its payment method and the organizations it
 * pays for. Individuals see their own plan and payment method.
 */
export function BillingSection() {
  const t = useTranslations("billing");
  const overview = useQuery(api.platform.billing.overview);
  const price = usePlanPrice();
  if (!overview?.organization) return null;
  const individuals = overview.mode === "individuals";

  return (
    <div className="space-y-6" data-testid="billing-section">
      {overview.plan && <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{individuals ? t("individualDescription") : t("description", { organization: overview.organization.name })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="font-medium" data-testid="current-plan">{overview.plan.name}</div>
              <div className="text-sm text-muted-foreground">{price(overview.plan)}</div>
            </div>
            {!individuals && (
              <div className="text-sm text-muted-foreground">
                {overview.payer ? t("paidBy", { name: overview.payer.name }) : t("noPayer")}
              </div>
            )}
          </div>
          {overview.payer && (individuals || overview.payer.canManage) && (
            <PaymentMethodEditor billingOrganizationId={overview.payer.id} current={overview.payer.paymentMethod} />
          )}
          {overview.canChangePlan ? (
            <ChangePlan
              organizationId={overview.organization.id}
              currentPlanId={overview.plan.id}
              plans={overview.payer ? overview.plans : overview.plans.filter((plan) => plan.isFreeForever)}
            />
          ) : overview.payer && (
            <p className="text-sm text-muted-foreground">{t("managedByPayer", { name: overview.payer.name })}</p>
          )}
          {overview.canUpgrade && overview.plans.some((plan) => !plan.isFreeForever) && (
            <Upgrade
              organizationId={overview.organization.id}
              organizationName={overview.organization.name}
              plans={overview.plans.filter((plan) => !plan.isFreeForever)}
              payers={individuals ? [] : overview.billingOrganizations.filter((billing) => billing.canManage)}
              individuals={individuals}
            />
          )}
        </CardContent>
      </Card>}
      {!individuals && overview.billing && (
        <BillingOrganizationCard
          billing={overview.billing}
          name={overview.organization.name}
          plans={overview.plans}
          canCreate={overview.mode === "organizations"}
        />
      )}
    </div>
  );
}

function PaymentMethodEditor({ billingOrganizationId, current }: { billingOrganizationId: string; current: PaymentMethod | null }) {
  const t = useTranslations("billing");
  const save = useMutation(api.platform.billing.setPaymentMethod);
  const [method, setMethod] = React.useState<PaymentMethod | "">(current ?? "");
  const { busy, run } = useRun();
  React.useEffect(() => setMethod(current ?? ""), [current]);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (method) void run(() => save({ billingOrganizationId, paymentMethod: method }), t("paymentMethodSaved"));
      }}
    >
      <div className="min-w-48 flex-1"><PaymentMethodField id={`payment-${billingOrganizationId}`} value={method} onChange={setMethod} /></div>
      <Button type="submit" variant="outline" disabled={busy || !method || method === current}>{t("savePaymentMethod")}</Button>
    </form>
  );
}

function ChangePlan({ organizationId, currentPlanId, plans }: { organizationId: string; currentPlanId: string; plans: PlanOption[] }) {
  const t = useTranslations("billing");
  const price = usePlanPrice();
  const change = useMutation(api.platform.billing.changePlan);
  const [planId, setPlanId] = React.useState(currentPlanId);
  const { busy, run } = useRun();
  React.useEffect(() => setPlanId(currentPlanId), [currentPlanId]);
  const options = plans;
  if (options.every((plan) => plan.id === currentPlanId)) return null;
  const chosen = options.find((plan) => plan.id === planId);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen && planId !== currentPlanId) void run(() => change({ organizationId, planId }), t("planChanged", { plan: chosen.name }));
      }}
    >
      <div className="grid min-w-48 flex-1 gap-2">
        <Label htmlFor={`change-plan-${organizationId}`}>{t("changePlan")}</Label>
        <Select value={planId} onValueChange={setPlanId}>
          <SelectTrigger id={`change-plan-${organizationId}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name} · {price(plan)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" variant="outline" disabled={busy || planId === currentPlanId}>{t("changePlan")}</Button>
    </form>
  );
}

function Upgrade({ organizationId, organizationName, plans, payers, individuals }: {
  organizationId: string;
  organizationName: string;
  plans: PlanOption[];
  payers: { id: string; name: string; paymentMethod: PaymentMethod | null }[];
  individuals: boolean;
}) {
  const t = useTranslations("billing");
  const upgrade = useMutation(api.platform.billing.upgrade);
  const { planId, plan, setPlanId } = useSelectedPlan(plans);
  const [payer, setPayer] = React.useState<string>(payers[0]?.id ?? NEW_PAYER);
  const [name, setName] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod | "">("");
  const { busy, run } = useRun();
  const existing = payers.find((billing) => billing.id === payer);
  const needsMethod = !existing?.paymentMethod;
  const needsName = !individuals && !existing;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!plan) return;
    if (needsMethod && !method) return void toast.error(t("errors.paymentMethodRequired"));
    if (needsName && !name.trim()) return void toast.error(t("errors.nameRequired"));
    void run(() => upgrade({
      organizationId,
      planId,
      ...(existing ? { billingOrganizationId: existing.id } : {}),
      ...(needsName ? { newBillingOrganizationName: name.trim() } : {}),
      ...(method ? { paymentMethod: method } : {}),
    }), t("upgraded", { organization: organizationName, plan: plan.name }));
  };

  return (
    <>
      <Separator />
      <form className="grid gap-4" onSubmit={submit} data-testid="billing-upgrade">
        <div>
          <div className="font-medium">{t("upgradeTitle")}</div>
          <p className="text-sm text-muted-foreground">{t("upgradeDescription")}</p>
        </div>
        <PlanChoice plans={plans} value={planId} onChange={setPlanId} idPrefix={`upgrade-${organizationId}`} />
        {!individuals && (
          <div className="grid gap-2">
            <Label htmlFor={`upgrade-payer-${organizationId}`}>{t("payer")}</Label>
            <Select value={payer} onValueChange={setPayer}>
              <SelectTrigger id={`upgrade-payer-${organizationId}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {payers.map((billing) => <SelectItem key={billing.id} value={billing.id}>{billing.name}</SelectItem>)}
                <SelectItem value={NEW_PAYER}>{t("newPayer")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {needsName && (
          <div className="grid gap-2">
            <Label htmlFor={`upgrade-name-${organizationId}`}>{t("payerName")}</Label>
            <Input id={`upgrade-name-${organizationId}`} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
          </div>
        )}
        {needsMethod && <PaymentMethodField id={`upgrade-payment-${organizationId}`} value={method} onChange={setMethod} />}
        <div><Button type="submit" disabled={busy || !plan}>{t("upgradeAction")}</Button></div>
      </form>
    </>
  );
}

function BillingOrganizationCard({ billing, name, plans, canCreate }: {
  billing: { id: string; paymentMethod: PaymentMethod | null; canManage: boolean; organizations: { organizationId: string; name: string; plan: PlanOption }[] };
  name: string;
  plans: PlanOption[];
  canCreate: boolean;
}) {
  const t = useTranslations("billing");
  const price = usePlanPrice();
  const [creating, setCreating] = React.useState(false);
  return (
    <Card data-testid="billing-organization">
      <CardHeader>
        <CardTitle className="text-base">{t("billingTitle")}</CardTitle>
        <CardDescription>{t("billingDescription", { name })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {billing.canManage
          ? <PaymentMethodEditor billingOrganizationId={billing.id} current={billing.paymentMethod} />
          : billing.paymentMethod && <p className="text-sm">{t("paymentMethod")}: {t(`paymentMethods.${billing.paymentMethod}`)}</p>}
        <div className="space-y-2">
          <div className="text-sm font-medium">{t("paysFor")}</div>
          {billing.organizations.length === 0
            ? <p className="text-sm text-muted-foreground">{t("paysForNone")}</p>
            : (
              <ul className="divide-y rounded-md border">
                {billing.organizations.map((organization) => (
                  <li key={organization.organizationId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="truncate">{organization.name}</span>
                    <span className="text-muted-foreground">{organization.plan.name} · {price(organization.plan)}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
        {billing.canManage && canCreate && (
          <>
            <Button variant="outline" onClick={() => setCreating(true)}><Plus className="me-2 h-4 w-4" />{t("createAction")}</Button>
            <CreateOrganizationDialog open={creating} onOpenChange={setCreating} billingOrganizationId={billing.id} billingName={name} plans={plans} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
