import { refuse } from "@web-app-starter/convex-platform/errors";
/**
 * Shared rules for tenancy, plans and billing organizations (platform/docs/tenancy-and-billing.md).
 * The component (`components.platform.billing`) stores the rows; these helpers decide who may act
 * and keep organizations and their plans together.
 */
import { components } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { findById, findMembership, isDeleting, listMemberships, parseRole } from "./organizationAccess";

type Reader = Pick<QueryCtx, "runQuery" | "db">;
type Writer = Pick<MutationCtx, "runQuery" | "runMutation" | "db">;

export type TenancyMode = "individuals" | "organizations";
export const TENANCY_MODE_KEY = "tenancyMode";

/** Who did something, for the component's audit events. */
export type Actor = { userId?: string; email: string };
export const SYSTEM_ACTOR: Actor = { email: "system" };

export function actorOf(user: Pick<Doc<"user">, "_id" | "email">): Actor {
  return { userId: user._id, email: user.email };
}

/** The mode the platform admin chose; `null` until a setup has finished. */
export async function readTenancyMode(ctx: Pick<QueryCtx, "runQuery">): Promise<TenancyMode | null> {
  const row = await ctx.runQuery(components.platform.appSettings.getRaw, { key: TENANCY_MODE_KEY });
  return row?.value === "individuals" || row?.value === "organizations" ? row.value : null;
}

export type PlanDoc = {
  _id: string;
  name: string;
  priceMonthlyUsdCents: number;
  isFreeForever: boolean;
  isSeeded: boolean;
  isDefault: boolean;
  status: "active" | "inactive" | "archived";
};

export function planView(plan: PlanDoc) {
  return {
    id: plan._id,
    name: plan.name,
    priceMonthlyUsdCents: plan.priceMonthlyUsdCents,
    isFreeForever: plan.isFreeForever,
    isDefault: plan.isDefault,
  };
}

export async function activePlans(ctx: Pick<QueryCtx, "runQuery">): Promise<PlanDoc[]> {
  return (await ctx.runQuery(components.platform.billing.listPlans, {})).filter((plan) => plan.status === "active");
}

/**
 * The plan a new organization starts on: the default while it is free-forever, else the seeded
 * free-forever plan. A paid plan needs a payer, which only an explicit choice provides.
 */
export async function initialPlanId(ctx: Writer): Promise<string> {
  const seeded = await ctx.runMutation(components.platform.billing.ensureSeeded, {});
  const plans = await ctx.runQuery(components.platform.billing.listPlans, {});
  const fallback = plans.find((plan) => plan.isDefault && plan.isFreeForever && plan.status === "active");
  return fallback?._id ?? seeded;
}

/** Owners and admins of a billing organization act for it; its members only view. */
export async function billingRole(ctx: Pick<QueryCtx, "runQuery">, userId: string, billingOrganizationId: string) {
  const billing = await ctx.runQuery(components.platform.billing.getBilling, { billingOrganizationId });
  if (!billing || billing.deletedAt) return null;
  const organization = await findById(ctx, "organization", billing.organizationId);
  if (!organization || isDeleting(organization)) return null;
  const member = await findMembership(ctx, userId, billing.organizationId);
  if (!member) return null;
  const role = parseRole(member.role);
  return { billing, role, canManage: role !== "member" };
}

export async function assertManagesBilling(ctx: Pick<QueryCtx, "runQuery">, userId: string, billingOrganizationId: string) {
  const access = await billingRole(ctx, userId, billingOrganizationId);
  if (!access) refuse("BILLING_ORGANIZATION_NOT_FOUND");
  if (!access.canManage) refuse("NOT_ALLOWED");
  return access.billing;
}

/** Billing organizations the user belongs to, with their role. */
export async function myBillingOrganizations(ctx: Pick<QueryCtx, "runQuery">, userId: string) {
  const memberships = await listMemberships(ctx, userId);
  const rows = await Promise.all(memberships.map(async (member) => {
    const billing = await ctx.runQuery(components.platform.billing.billingByOrganization, { organizationId: member.organizationId });
    if (!billing || billing.deletedAt) return null;
    const organization = await findById(ctx, "organization", member.organizationId);
    if (!organization || isDeleting(organization)) return null;
    const role = parseRole(member.role);
    return { id: billing._id, organizationId: organization._id, name: organization.name, paymentMethod: billing.paymentMethod ?? null, role, canManage: role !== "member" };
  }));
  return rows.filter((row) => row !== null);
}

/**
 * Give a new organization its plan, in the caller's transaction. Individuals: the organization is
 * also its own billing organization. A user who still has a choice to make is asked to pick a
 * plan before using the app.
 */
export async function provisionOrganizationPlan(
  ctx: Writer,
  organization: { id: string; name: string },
  mode: TenancyMode | null,
  actor: Actor,
  pickerFor?: string,
): Promise<void> {
  const current = await ctx.runQuery(components.platform.billing.currentPlan, { organizationId: organization.id });
  if (current) return;
  const planId = await initialPlanId(ctx);
  let billingOrganizationId: string | undefined;
  if (mode === "individuals") {
    const existing = await ctx.runQuery(components.platform.billing.billingByOrganization, { organizationId: organization.id });
    billingOrganizationId = existing && !existing.deletedAt ? existing._id
      : await ctx.runMutation(components.platform.billing.createBilling, { organizationId: organization.id, organizationName: organization.name, actor });
  }
  await ctx.runMutation(components.platform.billing.startPlan, {
    organizationId: organization.id, organizationName: organization.name, planId, billingOrganizationId, actor,
  });
  const available = await activePlans(ctx);
  if (pickerFor && mode && (available.length !== 1 || available[0]!._id !== planId || !available[0]!.isFreeForever)) {
    const pending = await ctx.db.query("pendingPlanChoices").withIndex("by_user", (q) => q.eq("userId", pickerFor)).first();
    if (!pending) await ctx.db.insert("pendingPlanChoices", { userId: pickerFor, organizationId: organization.id, createdAt: Date.now() });
  }
}

/** The plan choice still waiting for this user, if any. */
export async function pendingPlanChoice(ctx: Pick<QueryCtx, "db" | "runQuery">, userId: string) {
  const choice = await ctx.db.query("pendingPlanChoices").withIndex("by_user", (q) => q.eq("userId", userId)).first();
  if (!choice) return null;
  const member = await findMembership(ctx, userId, choice.organizationId);
  if (!member || parseRole(member.role) === "member") return null;
  const current = await ctx.runQuery(components.platform.billing.currentPlan, { organizationId: choice.organizationId });
  if (current?.billing && !current.billing.deletedAt && !(await billingRole(ctx, userId, current.billing._id))?.canManage) return null;
  return choice;
}

/** The user's scheduled deletion, if any. */
export async function scheduledDeletion(ctx: Pick<QueryCtx, "db">, userId: string) {
  return await ctx.db.query("userDeletions").withIndex("by_user", (q) => q.eq("userId", userId)).first();
}

/**
 * What stops the app for this user before anything else: a scheduled deletion, then a plan still
 * to choose. Every organization-scoped function refuses with it (functions.ts).
 */
export async function appBlocker(ctx: Pick<QueryCtx, "db" | "runQuery">, userId: string): Promise<"USER_DELETION_SCHEDULED" | "PLAN_CHOICE_REQUIRED" | null> {
  if (await scheduledDeletion(ctx, userId)) return "USER_DELETION_SCHEDULED";
  if (await pendingPlanChoice(ctx, userId)) return "PLAN_CHOICE_REQUIRED";
  return null;
}

/** Plan names and prices are shown with the organization's plan. */
export async function organizationPlanView(ctx: Pick<QueryCtx, "runQuery">, organizationId: string) {
  const current = await ctx.runQuery(components.platform.billing.currentPlan, { organizationId });
  if (!current) return null;
  return { plan: planView(current.plan), billing: current.billing && !current.billing.deletedAt ? current.billing : null };
}

export type { Reader, Writer };
