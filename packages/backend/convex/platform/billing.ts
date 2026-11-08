import { refuse } from "@web-app-starter/convex-platform/errors";
/**
 * Plans and billing for users and platform admins (platform/docs/tenancy-and-billing.md).
 *
 * Users: the sign-up plan picker, the active organization's plan and payer, plan changes by the
 * payer's owners and admins, upgrades of a free-forever organization without a payer, payment
 * methods and creating organizations from a billing organization. Platform admins: the plan
 * catalog. Every write is checked here and stored by `components.platform.billing`.
 */
import type { PaginationResult } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { adminMutation, authedMutation, authedPaginatedQuery, authedQuery } from "./functions";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import {
  activePlans,
  actorOf,
  assertManagesBilling,
  billingRole,
  myBillingOrganizations,
  pendingPlanChoice,
  planView,
  readTenancyMode,
  scheduledDeletion,
  type Actor,
} from "./billingAccess";
import {
  createOrganizationWithOwner,
  findById,
  findMembership,
  isDeleting,
  parseRole,
  resolveActiveOrganization,
} from "./organizationAccess";
import { assertMaxLength } from "@web-app-starter/convex-platform/validation";

const paymentMethod = v.union(v.literal("cash"), v.literal("check"));
type PaymentMethod = "cash" | "check";
type Ctx = Pick<MutationCtx, "runQuery" | "runMutation" | "db" | "scheduler">;

function requireAdmin(user: Doc<"user">) {
  if (user.role !== "admin") refuse("NOT_ADMIN");
}

function requireAppUser(user: Doc<"user">) {
  if (user.role === "admin") refuse("NOT_APPLICATION_USER");
}

function organizationName(name: string | undefined): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) refuse("ORGANIZATION_NAME_REQUIRED");
  assertMaxLength(trimmed, 100, "name");
  return trimmed;
}

async function activePlan(ctx: Pick<MutationCtx, "runQuery">, planId: string) {
  const plan = await ctx.runQuery(components.platform.billing.getPlan, { planId });
  if (!plan || plan.status !== "active") refuse("PLAN_NOT_AVAILABLE");
  return plan;
}

async function organizationOrThrow(ctx: Pick<MutationCtx, "runQuery">, organizationId: string) {
  const organization = await findById(ctx, "organization", organizationId);
  if (!organization || isDeleting(organization)) refuse("ORGANIZATION_NOT_FOUND");
  return organization;
}

/** Use an existing billing organization the user manages, or create one, and return it with a payment method. */
async function payerFor(
  ctx: Ctx,
  user: Doc<"user">,
  organization: Doc<"organization">,
  args: { billingOrganizationId?: string; newBillingOrganizationName?: string; paymentMethod?: PaymentMethod },
  actor: Actor,
): Promise<string> {
  const mode = await readTenancyMode(ctx);
  let billingOrganizationId = args.billingOrganizationId;
  if (billingOrganizationId) {
    await assertManagesBilling(ctx, user._id, billingOrganizationId);
  } else if (mode === "individuals") {
    // The individual's organization is also their billing organization.
    const existing = await ctx.runQuery(components.platform.billing.billingByOrganization, { organizationId: organization._id });
    billingOrganizationId = existing && !existing.deletedAt ? existing._id
      : await ctx.runMutation(components.platform.billing.createBilling, { organizationId: organization._id, organizationName: organization.name, actor });
  } else {
    const name = organizationName(args.newBillingOrganizationName);
    const organizationId = await createOrganizationWithOwner(ctx, name, user._id);
    await scheduleAuditEvent(ctx, { actor: user.email, authenticatedUserId: user._id, sourceDetail: "billing", action: "organization.created", resource: `organization:${organizationId}`, status: "succeeded", meta: JSON.stringify({ billing: true }) });
    billingOrganizationId = await ctx.runMutation(components.platform.billing.createBilling, { organizationId, organizationName: name, actor });
  }
  if (args.paymentMethod) {
    await ctx.runMutation(components.platform.billing.setPaymentMethod, { billingOrganizationId, paymentMethod: args.paymentMethod, actor });
  }
  return billingOrganizationId;
}

// ---------------------------------------------------------------------------
// What the web app shows
// ---------------------------------------------------------------------------

/**
 * What keeps the app closed for the caller, if anything: a scheduled deletion, then the plan
 * picker. Also the tenancy mode, so the app knows which organization screens exist.
 */
export const myStatus = authedQuery({
  args: {},
  handler: async (ctx) => {
    const mode = await readTenancyMode(ctx);
    const deletion = await scheduledDeletion(ctx, ctx.user._id);
    const choice = deletion ? null : await pendingPlanChoice(ctx, ctx.user._id);
    const plans = choice ? (await activePlans(ctx)).map(planView) : [];
    return {
      mode,
      deletion: deletion ? { deleteAt: deletion.deleteAt, state: deletion.state, blockedReason: deletion.blockedReason ?? null } : null,
      planChoice: choice ? { organizationId: choice.organizationId, plans } : null,
    };
  },
});

/**
 * The active organization's plan and payer, what the caller may do about them, and, when the
 * active organization is a billing organization, its payment method (`paidOrganizations` lists
 * what it pays for, a page at a time).
 */
export const overview = authedQuery({
  args: {},
  handler: async (ctx) => {
    if (ctx.user.role === "admin") return null;
    const mode = await readTenancyMode(ctx);
    const active = await resolveActiveOrganization(ctx, ctx.user, ctx.session);
    const plans = (await activePlans(ctx)).map(planView);
    const billingOrganizations = await myBillingOrganizations(ctx, ctx.user._id);
    if (!active) return { mode, organization: null, plans, billingOrganizations, billing: null };
    const organization = await findById(ctx, "organization", active.organizationId);
    if (!organization) return { mode, organization: null, plans, billingOrganizations, billing: null };
    const current = await ctx.runQuery(components.platform.billing.currentPlan, { organizationId: organization._id });
    const payer = current?.billing && !current.billing.deletedAt ? current.billing : null;
    const payerAccess = payer ? await billingRole(ctx, ctx.user._id, payer._id) : null;
    const orgCanManage = active.organizationRole !== "member";
    const ownBilling = await ctx.runQuery(components.platform.billing.billingByOrganization, { organizationId: organization._id });
    let billing = null;
    if (ownBilling && !ownBilling.deletedAt) {
      billing = { id: ownBilling._id, paymentMethod: ownBilling.paymentMethod ?? null, canManage: orgCanManage };
    }
    return {
      mode,
      organization: { id: organization._id, name: organization.name, role: active.organizationRole },
      plan: current ? planView(current.plan) : null,
      payer: payer ? { id: payer._id, name: (await findById(ctx, "organization", payer.organizationId))?.name ?? payer.organizationName, paymentMethod: payer.paymentMethod ?? null, canManage: payerAccess?.canManage ?? false } : null,
      /** The payer's owners and admins change a paid plan; without a payer, the organization's own do. */
      canChangePlan: payer ? payerAccess?.canManage ?? false : orgCanManage,
      /** A free-forever organization without a payer can be upgraded by its owners and admins. */
      canUpgrade: !payer && orgCanManage && (current?.plan.isFreeForever ?? true),
      plans,
      billingOrganizations,
      billing,
    };
  },
});

/** Organizations listed per page of `paidOrganizations`. */
const MAX_PAID_PAGE = 50;

/**
 * The organizations the active organization pays for, as a billing organization, with their
 * plans: a page at a time (at most 50). Empty when it isn't one. Any member may see them, as
 * `overview` shows its billing card to every member.
 */
export const paidOrganizations = authedPaginatedQuery({
  args: {},
  handler: async (ctx, args): Promise<PaginationResult<{ organizationId: string; name: string; plan: ReturnType<typeof planView> }>> => {
    if (args.paginationOpts.numItems > MAX_PAID_PAGE) refuse("INVALID_PAGE_SIZE");
    const none = { page: [], isDone: true, continueCursor: "" };
    if (ctx.user.role === "admin") return none;
    const active = await resolveActiveOrganization(ctx, ctx.user, ctx.session);
    if (!active) return none;
    const ownBilling = await ctx.runQuery(components.platform.billing.billingByOrganization, { organizationId: active.organizationId });
    if (!ownBilling || ownBilling.deletedAt) return none;
    const paid = await ctx.runQuery(components.platform.billing.paidBy, { billingOrganizationId: ownBilling._id, paginationOpts: args.paginationOpts });
    return {
      isDone: paid.isDone,
      continueCursor: paid.continueCursor,
      page: await Promise.all(paid.page.map(async ({ row, plan }) => ({
        organizationId: row.organizationId,
        name: (await findById(ctx, "organization", row.organizationId))?.name ?? row.organizationName,
        plan: planView(plan),
      }))),
    };
  },
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * The sign-up plan picker. A free-forever plan keeps the organization as it is; another plan
 * needs a payment method and, in organizations mode, names the new billing organization the user
 * will own.
 */
export const choosePlan = authedMutation({
  args: { planId: v.string(), paymentMethod: v.optional(paymentMethod), billingOrganizationName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireAppUser(ctx.user);
    if (await scheduledDeletion(ctx, ctx.user._id)) refuse("USER_DELETION_SCHEDULED");
    const choice = await pendingPlanChoice(ctx, ctx.user._id);
    if (!choice) refuse("NO_PLAN_CHOICE");
    const plan = await activePlan(ctx, args.planId);
    const organization = await organizationOrThrow(ctx, choice.organizationId);
    const actor = actorOf(ctx.user);
    const current = await ctx.runQuery(components.platform.billing.currentPlan, { organizationId: organization._id });
    if (plan.isFreeForever) {
      if (current?.plan._id !== plan._id) {
        await ctx.runMutation(components.platform.billing.startPlan, {
          organizationId: organization._id, organizationName: organization.name, planId: plan._id,
          billingOrganizationId: current?.billing && !current.billing.deletedAt ? current.billing._id : undefined, actor,
        });
      }
    } else {
      if (!args.paymentMethod) refuse("PAYMENT_METHOD_REQUIRED");
      const billingOrganizationId = await payerFor(ctx, ctx.user, organization, { billingOrganizationId: current?.billing && !current.billing.deletedAt ? current.billing._id : undefined, newBillingOrganizationName: args.billingOrganizationName, paymentMethod: args.paymentMethod }, actor);
      await ctx.runMutation(components.platform.billing.startPlan, {
        organizationId: organization._id, organizationName: organization.name, planId: plan._id, billingOrganizationId, actor,
      });
    }
    await ctx.db.delete(choice._id);
  },
});

/**
 * Change an organization's plan. With a payer: its owners and admins, and a free-forever plan
 * clears the payer (downgrade). Without one: the organization's owners and admins, between
 * free-forever plans only (`upgrade` adds a payer).
 */
export const changePlan = authedMutation({
  args: { organizationId: v.string(), planId: v.string() },
  handler: async (ctx, args) => {
    requireAppUser(ctx.user);
    if (await scheduledDeletion(ctx, ctx.user._id)) refuse("USER_DELETION_SCHEDULED");
    const organization = await organizationOrThrow(ctx, args.organizationId);
    const plan = await activePlan(ctx, args.planId);
    const current = await ctx.runQuery(components.platform.billing.currentPlan, { organizationId: organization._id });
    const payer = current?.billing && !current.billing.deletedAt ? current.billing : null;
    if (payer) {
      await assertManagesBilling(ctx, ctx.user._id, payer._id);
    } else {
      const member = await findMembership(ctx, ctx.user._id, organization._id);
      if (!member || parseRole(member.role) === "member") refuse("NOT_ALLOWED");
      if (!plan.isFreeForever) refuse("PAYER_REQUIRED");
    }
    if (current?.plan._id === plan._id) return;
    const individuals = (await readTenancyMode(ctx)) === "individuals";
    // A downgrade clears the payer, except an individual's own billing organization, which stays theirs.
    const keepPayer = payer && (!plan.isFreeForever || (individuals && payer.organizationId === organization._id));
    await ctx.runMutation(components.platform.billing.startPlan, {
      organizationId: organization._id, organizationName: organization.name, planId: plan._id,
      billingOrganizationId: keepPayer ? payer._id : undefined, actor: actorOf(ctx.user),
    });
  },
});

/**
 * Put a free-forever organization without a payer on a paid plan: its owners and admins pick a
 * billing organization they manage, or create one (organizations mode) with a payment method.
 */
export const upgrade = authedMutation({
  args: {
    organizationId: v.string(),
    planId: v.string(),
    billingOrganizationId: v.optional(v.string()),
    newBillingOrganizationName: v.optional(v.string()),
    paymentMethod: v.optional(paymentMethod),
  },
  handler: async (ctx, args) => {
    requireAppUser(ctx.user);
    if (await scheduledDeletion(ctx, ctx.user._id)) refuse("USER_DELETION_SCHEDULED");
    const organization = await organizationOrThrow(ctx, args.organizationId);
    const member = await findMembership(ctx, ctx.user._id, organization._id);
    if (!member || parseRole(member.role) === "member") refuse("NOT_ALLOWED");
    const current = await ctx.runQuery(components.platform.billing.currentPlan, { organizationId: organization._id });
    const individuals = (await readTenancyMode(ctx)) === "individuals";
    const ownPayer = individuals && current?.billing?.organizationId === organization._id;
    if (current?.billing && !current.billing.deletedAt && !ownPayer) refuse("ORGANIZATION_HAS_PAYER");
    const plan = await activePlan(ctx, args.planId);
    if (plan.isFreeForever) refuse("PLAN_NOT_PAID");
    const billingOrganizationId = await payerFor(ctx, ctx.user, organization, args, actorOf(ctx.user));
    await ctx.runMutation(components.platform.billing.startPlan, {
      organizationId: organization._id, organizationName: organization.name, planId: plan._id, billingOrganizationId, actor: actorOf(ctx.user),
    });
  },
});

export const setPaymentMethod = authedMutation({
  args: { billingOrganizationId: v.string(), paymentMethod },
  handler: async (ctx, args) => {
    requireAppUser(ctx.user);
    if (await scheduledDeletion(ctx, ctx.user._id)) refuse("USER_DELETION_SCHEDULED");
    await assertManagesBilling(ctx, ctx.user._id, args.billingOrganizationId);
    await ctx.runMutation(components.platform.billing.setPaymentMethod, { ...args, actor: actorOf(ctx.user) });
  },
});

/**
 * Organizations mode: a billing organization's owners and admins create an organization it pays
 * for, on any active plan; the creator owns it.
 */
export const createOrganization = authedMutation({
  args: { billingOrganizationId: v.string(), name: v.string(), planId: v.string() },
  handler: async (ctx, args) => {
    requireAppUser(ctx.user);
    if (await scheduledDeletion(ctx, ctx.user._id)) refuse("USER_DELETION_SCHEDULED");
    if ((await readTenancyMode(ctx)) !== "organizations") refuse("ORGANIZATION_CREATION_DISABLED");
    const billing = await assertManagesBilling(ctx, ctx.user._id, args.billingOrganizationId);
    const plan = await activePlan(ctx, args.planId);
    if (!plan.isFreeForever && !billing.paymentMethod) refuse("PAYMENT_METHOD_REQUIRED");
    const name = organizationName(args.name);
    const organizationId = await createOrganizationWithOwner(ctx, name, ctx.user._id);
    await ctx.runMutation(components.platform.billing.startPlan, {
      organizationId, organizationName: name, planId: plan._id, billingOrganizationId: billing._id, actor: actorOf(ctx.user),
    });
    await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.user._id, sourceDetail: "billing", action: "organization.created", resource: `organization:${organizationId}`, status: "succeeded", meta: JSON.stringify({ billingOrganizationId: billing._id }) });
    return { organizationId };
  },
});

// ---------------------------------------------------------------------------
// Platform admins: the plan catalog
// ---------------------------------------------------------------------------

export const listPlans = authedQuery({
  args: {},
  handler: async (ctx) => {
    requireAdmin(ctx.user);
    return (await ctx.runQuery(components.platform.billing.listPlans, {})).map((plan) => ({
      id: plan._id,
      name: plan.name,
      priceMonthlyUsdCents: plan.priceMonthlyUsdCents,
      isFreeForever: plan.isFreeForever,
      isSeeded: plan.isSeeded,
      isDefault: plan.isDefault,
      status: plan.status,
      inUse: plan.inUse,
    }));
  },
});

export const createPlan = adminMutation({
  args: { name: v.string(), priceMonthlyUsdCents: v.number(), isFreeForever: v.boolean() },
  handler: async (ctx, args) => {
    requireAdmin(ctx.user);
    await ctx.runMutation(components.platform.billing.ensureSeeded, {});
    return await ctx.runMutation(components.platform.billing.createPlan, { ...args, actor: actorOf(ctx.user) });
  },
});

export const updatePlan = adminMutation({
  args: {
    planId: v.string(),
    name: v.optional(v.string()),
    priceMonthlyUsdCents: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    requireAdmin(ctx.user);
    await ctx.runMutation(components.platform.billing.updatePlan, { ...args, actor: actorOf(ctx.user) });
  },
});

/** While a tenancy mode is being turned on, the default stays free-forever (tenancy.ts). */
export const setDefaultPlan = adminMutation({
  args: { planId: v.string() },
  handler: async (ctx, args) => {
    requireAdmin(ctx.user);
    const running = await ctx.db.query("tenancySetups").order("desc").first();
    const plan = await ctx.runQuery(components.platform.billing.getPlan, { planId: args.planId });
    if (running?.state === "running" && plan && !plan.isFreeForever) refuse("TENANCY_SETUP_RUNNING");
    await ctx.runMutation(components.platform.billing.setDefaultPlan, { planId: args.planId, actor: actorOf(ctx.user) });
  },
});

/** Seeds the free-forever plan for the admin app's first visit. */
export const ensureSeeded = adminMutation({
  args: {},
  handler: async (ctx) => {
    requireAdmin(ctx.user);
    await ctx.runMutation(components.platform.billing.ensureSeeded, {});
  },
});
