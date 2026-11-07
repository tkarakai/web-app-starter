/**
 * Plans, billing organizations and organization plans (platform/docs/tenancy-and-billing.md).
 * Trusted app callers only: the app checks who may act and that organizations exist; this
 * module keeps the billing rules that need no Better Auth data. Billing rows are history and
 * are never deleted.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./functions";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { assertMaxLength, MAX_NAME_LENGTH } from "./inputLimits";
import {
  billingOrganizationsFields,
  organizationPlansFields,
  paymentMethodValidator,
  planStatusValidator,
  plansFields,
} from "./schema";

const planRow = v.object({ _id: v.id("plans"), _creationTime: v.number(), ...plansFields });
const billingRow = v.object({ _id: v.id("billingOrganizations"), _creationTime: v.number(), ...billingOrganizationsFields });
const organizationPlanRow = v.object({ _id: v.id("organizationPlans"), _creationTime: v.number(), ...organizationPlansFields });
const actor = v.object({ userId: v.optional(v.string()), email: v.string() });
type Actor = { userId?: string; email: string };

/** Name of the free-forever plan seeded at install. */
export const SEEDED_PLAN_NAME = "Free";
/** Highest monthly price accepted: $1,000,000.00. */
const MAX_PRICE_CENTS = 100_000_000;

function audit(ctx: Pick<MutationCtx, "scheduler">, who: Actor, action: Parameters<typeof scheduleAuditEvent>[1]["action"], resource: string, meta?: Record<string, unknown>) {
  return scheduleAuditEvent(ctx, {
    actor: who.email,
    authenticatedUserId: who.userId,
    sourceDetail: "billing",
    action,
    resource,
    status: "succeeded",
    meta: meta ? JSON.stringify(meta) : undefined,
  });
}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("PLAN_NAME_REQUIRED");
  assertMaxLength(trimmed, MAX_NAME_LENGTH, "name");
  return trimmed;
}

function assertPrice(cents: number): number {
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_PRICE_CENTS) throw new Error("INVALID_PRICE");
  return cents;
}

async function planInUse(ctx: QueryCtx, planId: Id<"plans">): Promise<boolean> {
  return (await ctx.db.query("organizationPlans").withIndex("by_plan", (q) => q.eq("planId", planId)).first()) !== null;
}

async function currentRow(ctx: QueryCtx, organizationId: string): Promise<Doc<"organizationPlans"> | null> {
  return await ctx.db.query("organizationPlans")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId).eq("endedAt", undefined))
    .first();
}

async function billingFor(ctx: QueryCtx, organizationId: string): Promise<Doc<"billingOrganizations"> | null> {
  return await ctx.db.query("billingOrganizations").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).first();
}

/** Current organization plans paid by a billing organization. */
async function paidRows(ctx: QueryCtx, billingOrganizationId: Id<"billingOrganizations">): Promise<Doc<"organizationPlans">[]> {
  return await ctx.db.query("organizationPlans")
    .withIndex("by_billing_organization", (q) => q.eq("billingOrganizationId", billingOrganizationId).eq("endedAt", undefined))
    .collect();
}

async function seededPlan(ctx: QueryCtx): Promise<Doc<"plans"> | null> {
  return (await ctx.db.query("plans").collect()).find((plan) => plan.isSeeded) ?? null;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/** Seed the free-forever plan once; it is the default until another plan is chosen. Idempotent. */
export const ensureSeeded = mutation({
  args: {},
  returns: v.id("plans"),
  handler: async (ctx) => {
    const existing = await seededPlan(ctx);
    if (existing) return existing._id;
    const hasDefault = (await ctx.db.query("plans").withIndex("by_default", (q) => q.eq("isDefault", true)).first()) !== null;
    const now = Date.now();
    return await ctx.db.insert("plans", {
      name: SEEDED_PLAN_NAME, priceMonthlyUsdCents: 0, isFreeForever: true, isSeeded: true, isDefault: !hasDefault,
      status: "active", createdAt: now, createdBy: "system", updatedAt: now,
    });
  },
});

export const listPlans = query({
  args: {},
  returns: v.array(v.object({ ...planRow.fields, inUse: v.boolean() })),
  handler: async (ctx) => {
    const plans = await ctx.db.query("plans").collect();
    plans.sort((a, b) => Number(b.isSeeded) - Number(a.isSeeded) || a.createdAt - b.createdAt);
    return await Promise.all(plans.map(async (plan) => ({ ...plan, inUse: await planInUse(ctx, plan._id) })));
  },
});

export const getPlan = query({
  args: { planId: v.string() },
  returns: v.union(planRow, v.null()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("plans", args.planId);
    return id ? await ctx.db.get(id) : null;
  },
});

export const createPlan = mutation({
  args: { name: v.string(), priceMonthlyUsdCents: v.number(), isFreeForever: v.boolean(), actor },
  returns: v.id("plans"),
  handler: async (ctx, args) => {
    const name = assertName(args.name);
    const price = assertPrice(args.priceMonthlyUsdCents);
    if (args.isFreeForever && price !== 0) throw new Error("FREE_FOREVER_PRICE_MUST_BE_ZERO");
    const now = Date.now();
    const id = await ctx.db.insert("plans", {
      name, priceMonthlyUsdCents: price, isFreeForever: args.isFreeForever, isSeeded: false, isDefault: false,
      status: "active", createdAt: now, createdBy: args.actor.userId ?? args.actor.email, updatedAt: now,
    });
    await audit(ctx, args.actor, "plan.created", `plan:${id}`, { name, priceMonthlyUsdCents: price, isFreeForever: args.isFreeForever });
    return id;
  },
});

/** Rename, reprice or change status. The seeded plan only changes status; a plan in use keeps its price. */
export const updatePlan = mutation({
  args: {
    planId: v.string(),
    name: v.optional(v.string()),
    priceMonthlyUsdCents: v.optional(v.number()),
    status: v.optional(planStatusValidator),
    actor,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("plans", args.planId);
    const plan = id ? await ctx.db.get(id) : null;
    if (!plan) throw new Error("PLAN_NOT_FOUND");
    const patch: Partial<Doc<"plans">> = {};
    if (args.name !== undefined && args.name.trim() !== plan.name) {
      if (plan.isSeeded) throw new Error("SEEDED_PLAN_LOCKED");
      patch.name = assertName(args.name);
    }
    if (args.priceMonthlyUsdCents !== undefined && args.priceMonthlyUsdCents !== plan.priceMonthlyUsdCents) {
      if (plan.isSeeded) throw new Error("SEEDED_PLAN_LOCKED");
      if (plan.isFreeForever) throw new Error("FREE_FOREVER_PRICE_MUST_BE_ZERO");
      if (await planInUse(ctx, plan._id)) throw new Error("PLAN_IN_USE");
      patch.priceMonthlyUsdCents = assertPrice(args.priceMonthlyUsdCents);
    }
    if (args.status !== undefined && args.status !== plan.status) {
      if (plan.isDefault && args.status !== "active") throw new Error("DEFAULT_PLAN_MUST_BE_ACTIVE");
      patch.status = args.status;
    }
    if (Object.keys(patch).length === 0) return null;
    await ctx.db.patch(plan._id, { ...patch, updatedAt: Date.now(), updatedBy: args.actor.userId ?? args.actor.email });
    await audit(ctx, args.actor, "plan.updated", `plan:${plan._id}`, patch);
    return null;
  },
});

export const setDefaultPlan = mutation({
  args: { planId: v.string(), actor },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("plans", args.planId);
    const plan = id ? await ctx.db.get(id) : null;
    if (!plan) throw new Error("PLAN_NOT_FOUND");
    if (plan.status !== "active") throw new Error("DEFAULT_PLAN_MUST_BE_ACTIVE");
    if (plan.isDefault) return null;
    const now = Date.now();
    const updatedBy = args.actor.userId ?? args.actor.email;
    for (const previous of await ctx.db.query("plans").withIndex("by_default", (q) => q.eq("isDefault", true)).collect()) {
      await ctx.db.patch(previous._id, { isDefault: false, updatedAt: now, updatedBy });
    }
    await ctx.db.patch(plan._id, { isDefault: true, updatedAt: now, updatedBy });
    await audit(ctx, args.actor, "plan.default_changed", `plan:${plan._id}`, { name: plan.name });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Billing organizations
// ---------------------------------------------------------------------------

export const billingByOrganization = query({
  args: { organizationId: v.string() },
  returns: v.union(billingRow, v.null()),
  handler: async (ctx, args) => await billingFor(ctx, args.organizationId),
});

export const getBilling = query({
  args: { billingOrganizationId: v.string() },
  returns: v.union(billingRow, v.null()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("billingOrganizations", args.billingOrganizationId);
    return id ? await ctx.db.get(id) : null;
  },
});

/** Mark an organization as a billing organization. One row per organization, ever. */
export const createBilling = mutation({
  args: { organizationId: v.string(), organizationName: v.string(), paymentMethod: v.optional(paymentMethodValidator), actor },
  returns: v.id("billingOrganizations"),
  handler: async (ctx, args) => {
    if (await billingFor(ctx, args.organizationId)) throw new Error("BILLING_ORGANIZATION_EXISTS");
    const id = await ctx.db.insert("billingOrganizations", {
      organizationId: args.organizationId,
      organizationName: args.organizationName,
      ...(args.paymentMethod ? { paymentMethod: args.paymentMethod } : {}),
      createdAt: Date.now(),
    });
    await audit(ctx, args.actor, "billing.organization_created", `organization:${args.organizationId}`, { billingOrganizationId: id, paymentMethod: args.paymentMethod });
    return id;
  },
});

export const setPaymentMethod = mutation({
  args: { billingOrganizationId: v.string(), paymentMethod: paymentMethodValidator, actor },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("billingOrganizations", args.billingOrganizationId);
    const billing = id ? await ctx.db.get(id) : null;
    if (!billing || billing.deletedAt) throw new Error("BILLING_ORGANIZATION_NOT_FOUND");
    if (billing.paymentMethod === args.paymentMethod) return null;
    await ctx.db.patch(billing._id, { paymentMethod: args.paymentMethod });
    await audit(ctx, args.actor, "billing.payment_method_changed", `organization:${billing.organizationId}`, { from: billing.paymentMethod, to: args.paymentMethod });
    return null;
  },
});

/** Current organization plans a billing organization pays for, with their plans. */
export const paidBy = query({
  args: { billingOrganizationId: v.string() },
  returns: v.array(v.object({ row: organizationPlanRow, plan: planRow })),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("billingOrganizations", args.billingOrganizationId);
    if (!id) return [];
    const rows = await paidRows(ctx, id);
    return (await Promise.all(rows.map(async (row) => {
      const plan = await ctx.db.get(row.planId);
      return plan ? { row, plan } : null;
    }))).filter((entry): entry is { row: Doc<"organizationPlans">; plan: Doc<"plans"> } => entry !== null);
  },
});

/**
 * Whether deleting this organization would leave another organization's current plan without
 * its payer (`BILLING_ORGANIZATION_IN_USE`). The organization's own plan doesn't count: it ends
 * with the organization.
 */
export const billingInUse = query({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const billing = await billingFor(ctx, args.organizationId);
    if (!billing || billing.deletedAt) return false;
    return (await paidRows(ctx, billing._id)).some((row) => row.organizationId !== args.organizationId);
  },
});

/**
 * An organization is being deleted: end its plan and mark its billing row deleted. Refused while
 * it pays for another organization's current plan. Both rows stay as billing history.
 */
export const organizationDeleted = mutation({
  args: { organizationId: v.string(), actor },
  returns: v.null(),
  handler: async (ctx, args) => {
    const billing = await billingFor(ctx, args.organizationId);
    if (billing && !billing.deletedAt && (await paidRows(ctx, billing._id)).some((row) => row.organizationId !== args.organizationId)) {
      throw new Error("BILLING_ORGANIZATION_IN_USE");
    }
    const now = Date.now();
    const current = await currentRow(ctx, args.organizationId);
    if (current) await ctx.db.patch(current._id, { endedAt: now });
    if (billing && !billing.deletedAt) {
      await ctx.db.patch(billing._id, { deletedAt: now });
      await audit(ctx, args.actor, "billing.organization_deleted", `organization:${args.organizationId}`, { billingOrganizationId: billing._id });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Organization plans
// ---------------------------------------------------------------------------

export const currentPlan = query({
  args: { organizationId: v.string() },
  returns: v.union(v.object({ row: organizationPlanRow, plan: planRow, billing: v.union(billingRow, v.null()) }), v.null()),
  handler: async (ctx, args) => {
    const row = await currentRow(ctx, args.organizationId);
    if (!row) return null;
    const plan = await ctx.db.get(row.planId);
    if (!plan) return null;
    const billing = row.billingOrganizationId ? await ctx.db.get(row.billingOrganizationId) : null;
    return { row, plan, billing };
  },
});

/**
 * Put an organization on a plan: end its current row (if any) and start a new one. A plan that
 * isn't free-forever needs a payer with a payment method; a free-forever plan may have one.
 */
export const startPlan = mutation({
  args: {
    organizationId: v.string(),
    organizationName: v.string(),
    planId: v.string(),
    billingOrganizationId: v.optional(v.string()),
    actor,
  },
  returns: v.id("organizationPlans"),
  handler: async (ctx, args) => {
    const planId = ctx.db.normalizeId("plans", args.planId);
    const plan = planId ? await ctx.db.get(planId) : null;
    if (!plan) throw new Error("PLAN_NOT_FOUND");
    let billing: Doc<"billingOrganizations"> | null = null;
    if (args.billingOrganizationId !== undefined) {
      const billingId = ctx.db.normalizeId("billingOrganizations", args.billingOrganizationId);
      billing = billingId ? await ctx.db.get(billingId) : null;
      if (!billing || billing.deletedAt) throw new Error("BILLING_ORGANIZATION_NOT_FOUND");
    }
    if (!plan.isFreeForever) {
      if (!billing) throw new Error("PAYER_REQUIRED");
      if (!billing.paymentMethod) throw new Error("PAYMENT_METHOD_REQUIRED");
    }
    const now = Date.now();
    const current = await currentRow(ctx, args.organizationId);
    if (current) await ctx.db.patch(current._id, { endedAt: now });
    const id = await ctx.db.insert("organizationPlans", {
      organizationId: args.organizationId,
      organizationName: args.organizationName,
      planId: plan._id,
      ...(billing ? { billingOrganizationId: billing._id } : {}),
      createdAt: now,
    });
    await audit(ctx, args.actor, "organization.plan_changed", `organization:${args.organizationId}`, {
      planId: plan._id, planName: plan.name, billingOrganizationId: billing?._id, previousPlanId: current?.planId,
    });
    return id;
  },
});
