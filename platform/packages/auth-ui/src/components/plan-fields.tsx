"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import { Label, RadioGroup, RadioGroupItem, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@web-app-starter/design-system";

import { formatPrice, type PaymentMethod, type PlanOption } from "../lib/billing";

/** A plan's price as shown to users: "Free" for free-forever plans, else "$19.00 per month". */
export function usePlanPrice(): (plan: Pick<PlanOption, "isFreeForever" | "priceMonthlyUsdCents">) => string {
  const t = useTranslations("billing");
  const locale = useLocale();
  return (plan) => plan.isFreeForever ? t("free") : t("perMonth", { price: formatPrice(plan.priceMonthlyUsdCents, locale) });
}

/** Choose one of the plans: name and price per option. */
export function PlanChoice({ plans, value, onChange, idPrefix }: {
  plans: PlanOption[];
  value: string;
  onChange: (planId: string) => void;
  idPrefix: string;
}) {
  const t = useTranslations("billing");
  const price = usePlanPrice();
  return (
    <div className="grid gap-2">
      <Label id={`${idPrefix}-label`}>{t("plan")}</Label>
      <RadioGroup aria-labelledby={`${idPrefix}-label`} value={value} onValueChange={onChange} className="grid gap-2">
        {plans.map((plan) => (
          <label key={plan.id} htmlFor={`${idPrefix}-${plan.id}`} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-primary">
            <RadioGroupItem id={`${idPrefix}-${plan.id}`} value={plan.id} />
            <span className="flex-1 font-medium">{plan.name}</span>
            <span className="text-sm text-muted-foreground">{price(plan)}</span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

/** Cash or check: a stand-in until a payment provider is integrated. */
export function PaymentMethodField({ value, onChange, id }: { value: PaymentMethod | ""; onChange: (method: PaymentMethod) => void; id: string }) {
  const t = useTranslations("billing");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t("paymentMethod")}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as PaymentMethod)}>
        <SelectTrigger id={id}><SelectValue placeholder={t("paymentMethod")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="cash">{t("paymentMethods.cash")}</SelectItem>
          <SelectItem value="check">{t("paymentMethods.check")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** The plan preselected in a picker: the default when offered, else the first. */
export function initialPlanId(plans: PlanOption[]): string {
  return plans.find((plan) => plan.isDefault)?.id ?? plans[0]?.id ?? "";
}

export function useSelectedPlan(plans: PlanOption[]) {
  const [planId, setPlanId] = React.useState("");
  const selected = plans.find((plan) => plan.id === planId) ?? plans.find((plan) => plan.id === initialPlanId(plans));
  return { planId: selected?.id ?? "", plan: selected ?? null, setPlanId };
}
