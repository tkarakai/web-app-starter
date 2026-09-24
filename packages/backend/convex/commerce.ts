import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { authedQuery } from "./functions";

export const PLAN_IDS = ["starter", "pro", "team"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const ENTITLEMENTS = [
  "core_starter",
  "core_pro",
  "addons_billing",
  "priority_support",
] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];

export type CommerceCustomer = {
  email: string;
  provider: "lemonsqueezy";
  providerCustomerId: string;
};

export type CommerceOrder = {
  providerOrderId: string;
  email: string;
  planId: PlanId;
  amountCents: number;
  currency: string;
  status: "paid" | "refunded" | "chargeback";
};

export type License = {
  key: string;
  email: string;
  planId: PlanId;
  entitlements: Entitlement[];
  status: "active" | "revoked";
  issuedAt: number;
};

type PlanView = {
  planId: PlanId;
  name: string;
  priceCents: number;
  checkoutUrl: string;
  features: string[];
};

type SettingReadCtx = Pick<QueryCtx, "db">;

async function getSetting(
  ctx: SettingReadCtx,
  key: string,
): Promise<string | null> {
  const setting = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  return setting?.value ?? null;
}

async function getPriceInCents(
  ctx: SettingReadCtx,
  key: "starterPriceCents" | "proPriceCents" | "teamPriceCents",
  fallback: number,
): Promise<number> {
  const raw = await getSetting(ctx, key);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getCheckoutUrl(planId: PlanId): string {
  if (planId === "starter") {
    return process.env.LEMON_SQUEEZY_STARTER_URL ?? "#";
  }
  if (planId === "pro") {
    return process.env.LEMON_SQUEEZY_PRO_URL ?? "#";
  }
  return process.env.LEMON_SQUEEZY_TEAM_URL ?? "#";
}

function planFeatures(planId: PlanId): string[] {
  if (planId === "starter") {
    return [
      "Commercial use for one production project",
      "Security and bug-fix updates",
      "Email support",
    ];
  }
  if (planId === "pro") {
    return [
      "Up to three production projects",
      "Priority issue handling",
      "Launch templates and onboarding checklists",
    ];
  }
  return [
    "Unlimited projects within one legal entity",
    "Priority support lane",
    "Architecture review support",
  ];
}

function planName(planId: PlanId): string {
  if (planId === "starter") return "Starter";
  if (planId === "pro") return "Pro";
  return "Team";
}

async function buildPlanViews(ctx: SettingReadCtx): Promise<PlanView[]> {
  const starterPrice = await getPriceInCents(ctx, "starterPriceCents", 19_900);
  const proPrice = await getPriceInCents(ctx, "proPriceCents", 39_900);
  const teamPrice = await getPriceInCents(ctx, "teamPriceCents", 79_900);

  return [
    {
      planId: "starter",
      name: planName("starter"),
      priceCents: starterPrice,
      checkoutUrl: getCheckoutUrl("starter"),
      features: planFeatures("starter"),
    },
    {
      planId: "pro",
      name: planName("pro"),
      priceCents: proPrice,
      checkoutUrl: getCheckoutUrl("pro"),
      features: planFeatures("pro"),
    },
    {
      planId: "team",
      name: planName("team"),
      priceCents: teamPrice,
      checkoutUrl: getCheckoutUrl("team"),
      features: planFeatures("team"),
    },
  ];
}

export function entitlementsForPlan(planId: PlanId): Entitlement[] {
  if (planId === "starter") {
    return ["core_starter"];
  }
  if (planId === "pro") {
    return ["core_pro"];
  }
  return ["core_pro", "addons_billing", "priority_support"];
}

export function generateLicenseKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `WAS-${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}`.toUpperCase();
}

export const getPlans = query({
  args: {},
  handler: async (ctx) => {
    return await buildPlanViews(ctx);
  },
});

export const getPlansInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await buildPlanViews(ctx);
  },
});

export const getLicenseByKey = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const license = await ctx.db
      .query("licenses")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (!license || license.status !== "active") {
      return null;
    }

    return {
      key: license.key,
      email: license.email,
      planId: license.planId,
      entitlements: license.entitlements,
      status: license.status,
      issuedAt: license.issuedAt,
    } as License;
  },
});

export const listLicenses = authedQuery({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = ctx.user as Record<string, unknown>;
    const role = user.role;
    const ownEmail = String(user.email ?? "").toLowerCase();
    const targetEmail = String(args.email ?? ownEmail).toLowerCase();

    if (role !== "admin" && targetEmail !== ownEmail) {
      return null;
    }

    const licenses = await ctx.db
      .query("licenses")
      .withIndex("by_email", (q) => q.eq("email", targetEmail))
      .collect();

    return licenses
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((license) => ({
        _id: license._id,
        key: license.key,
        email: license.email,
        planId: license.planId,
        entitlements: license.entitlements,
        status: license.status,
        issuedAt: license.issuedAt,
        revokedAt: license.revokedAt,
      }));
  },
});

export const getActiveLicenseForOrder = internalQuery({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args) => {
    const license = await ctx.db
      .query("licenses")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .unique();

    if (!license || license.status !== "active") {
      return null;
    }

    return license._id as Id<"licenses">;
  },
});
