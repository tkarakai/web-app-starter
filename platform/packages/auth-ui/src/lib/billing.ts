"use client";

import { errorCode } from "@web-app-starter/agentic/errors";

import { useQuery } from "convex/react";

import { api } from "@repo/backend";

export type TenancyMode = "individuals" | "organizations";
export type PaymentMethod = "cash" | "check";
export type PlanOption = { id: string; name: string; priceMonthlyUsdCents: number; isFreeForever: boolean; isDefault: boolean };

/** The tenancy mode the platform admin chose: `undefined` while loading, `null` before one is chosen. */
export function useTenancyMode(): TenancyMode | null | undefined {
  return useQuery(api.platform.tenancy.mode)?.mode;
}

/** A plan's monthly price in the user's locale; prices are USD. */
export function formatPrice(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(cents / 100);
}

/** The `billing.errors.*` key for a Convex error thrown by `api.platform.billing.*`. */
export function billingErrorKey(error: unknown): "paymentMethodRequired" | "nameRequired" | "notAllowed" | "inUse" | "generic" {
  const code = errorCode(error);
  if (code === "PAYMENT_METHOD_REQUIRED") return "paymentMethodRequired";
  if (code === "ORGANIZATION_NAME_REQUIRED") return "nameRequired";
  if (code === "BILLING_ORGANIZATION_IN_USE") return "inUse";
  if (code === "NOT_ALLOWED" || code === "BILLING_ORGANIZATION_NOT_FOUND") return "notAllowed";
  return "generic";
}
