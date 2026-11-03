/**
 * Tenancy mode: the platform admin chooses `individuals` or `organizations` once
 * (platform/docs/tenancy-and-billing.md). Until a setup finishes, sign-ups and organization
 * creation are refused (`TENANCY_NOT_CONFIGURED`); existing users keep working. Turning a mode
 * on runs in batches: every organization gets its plan (and, for individuals, its billing row),
 * and for organizations on an install with users only, a billing organization and one shared
 * organization with every user are created.
 */
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, query } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { adminMutation, authedQuery } from "./functions";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import {
  initialPlanId,
  readTenancyMode,
  SYSTEM_ACTOR,
  TENANCY_MODE_KEY,
  type Actor,
  type TenancyMode,
} from "./billingAccess";
import { createOrganizationWithOwner, findById, listMemberships, listOrganizationMembers, MAX_MEMBERSHIPS_PER_USER } from "./organizationAccess";
import { canAct } from "./organizationOwnership";
import { assertLocalFixtures } from "./localFixtures";
import { assertMaxLength, MAX_NAME_LENGTH } from "@web-app-starter/convex-platform/validation";

type Reader = Pick<QueryCtx, "runQuery">;
type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

/** Organizations or users handled per setup step; each step is one transaction. */
const SETUP_BATCH = 50;
/** Users and organizations read to decide eligibility: a mode is turned on for fresh or small installs. */
const ELIGIBILITY_LIMIT = 2_000;

const modeValidator = v.union(v.literal("individuals"), v.literal("organizations"));

function requireAdmin(user: Doc<"user">) {
  if (user.role !== "admin") throw new Error("NOT_ADMIN");
}

async function page<T>(ctx: Reader, model: "organization" | "user", cursor: string | null, numItems = SETUP_BATCH): Promise<Page<T>> {
  return await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model,
    paginationOpts: { numItems, cursor },
  }) as Page<T>;
}

async function readAll<T>(ctx: Reader, model: "organization" | "user"): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  let cursor: string | null = null;
  do {
    const result: Page<T> = await page<T>(ctx, model, cursor, 200);
    rows.push(...result.page);
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor && rows.length < ELIGIBILITY_LIMIT);
  return { rows, complete: cursor === null };
}

async function currentSetup(ctx: Pick<QueryCtx, "db">) {
  return await ctx.db.query("tenancySetups").order("desc").first();
}

/** What the platform admin needs to decide, and whether each mode can be turned on now. */
async function eligibility(ctx: Reader) {
  const users = await readAll<Doc<"user">>(ctx, "user");
  const appUsers = users.rows.filter((user) => user.role !== "admin");
  const organizations = await readAll<Doc<"organization">>(ctx, "organization");
  let sharedOrganizations = 0;
  for (const organization of organizations.rows) {
    if ((await listOrganizationMembers(ctx, organization._id)).length > 1) sharedOrganizations++;
  }
  let usersWithoutOneOrganization = 0;
  for (const user of appUsers) {
    if ((await listMemberships(ctx, user._id)).length !== 1) usersWithoutOneOrganization++;
  }
  const plans = await ctx.runQuery(components.platform.billing.listPlans, {});
  const defaultPlan = plans.find((plan) => plan.isDefault) ?? null;
  const otherPlans = plans.filter((plan) => !plan.isSeeded).length;
  const complete = users.complete && organizations.complete;
  const plansReady = otherPlans > 0 && !!defaultPlan && defaultPlan.isFreeForever && defaultPlan.status === "active";
  return {
    complete,
    appUserCount: appUsers.length,
    candidates: appUsers.filter((user) => canAct(user)).slice(0, 200).map((user) => ({ id: user._id, name: user.name, email: user.email })),
    sharedOrganizations,
    plans: { otherPlans, defaultPlan: defaultPlan ? { id: defaultPlan._id, name: defaultPlan.name, isFreeForever: defaultPlan.isFreeForever, status: defaultPlan.status } : null, ready: plansReady },
    individualsAllowed: complete && sharedOrganizations === 0 && usersWithoutOneOrganization === 0,
    /** Organizations mode creates a shared organization only on an install with users and no shared organizations. */
    sharedStep: complete && appUsers.length > 0 && sharedOrganizations === 0,
  };
}

/** The mode, for every app: decides which organization and billing screens exist. */
export const mode = query({
  args: {},
  handler: async (ctx) => ({ mode: await readTenancyMode(ctx) }),
});

/** The admin app's tenancy page: the chosen mode, or what choosing one needs. */
export const status = authedQuery({
  args: {},
  handler: async (ctx) => {
    requireAdmin(ctx.user);
    const mode = await readTenancyMode(ctx);
    const setup = await currentSetup(ctx);
    const running = setup?.state === "running" ? { mode: setup.mode, step: setup.step, startedAt: setup.startedAt } : null;
    if (mode) return { mode, running: null, eligibility: null };
    return { mode: null, running, eligibility: running ? null : await eligibility(ctx) };
  },
});

/**
 * Turn on a mode. Needs a plan besides the seeded one and a free-forever default. Individuals:
 * every organization has one member and every user one organization. Organizations on an install
 * with users and no shared organizations: the billing user and admin (may be the same user) and
 * the names of the billing organization and the shared organization.
 */
export const configure = adminMutation({
  args: {
    mode: modeValidator,
    billingUserId: v.optional(v.string()),
    adminUserId: v.optional(v.string()),
    billingOrganizationName: v.optional(v.string()),
    sharedOrganizationName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(ctx.user);
    if (await readTenancyMode(ctx)) throw new Error("TENANCY_ALREADY_CONFIGURED");
    if ((await currentSetup(ctx))?.state === "running") throw new Error("TENANCY_SETUP_RUNNING");
    await ctx.runMutation(components.platform.billing.ensureSeeded, {});
    const check = await eligibility(ctx);
    if (!check.complete) throw new Error("TENANCY_INSTALL_TOO_LARGE");
    if (!check.plans.ready) throw new Error("TENANCY_PLANS_REQUIRED");
    if (args.mode === "individuals" && !check.individualsAllowed) throw new Error("TENANCY_INDIVIDUALS_NOT_ALLOWED");
    const shared = args.mode === "organizations" && check.sharedStep;
    const names: { billingOrganizationName?: string; sharedOrganizationName?: string } = {};
    if (shared) {
      for (const userId of [args.billingUserId, args.adminUserId]) {
        const user = userId ? await findById(ctx, "user", userId) : null;
        if (!user || user.role === "admin" || !canAct(user)) throw new Error("TENANCY_USER_REQUIRED");
      }
      for (const key of ["billingOrganizationName", "sharedOrganizationName"] as const) {
        const name = args[key]?.trim();
        if (!name) throw new Error("ORGANIZATION_NAME_REQUIRED");
        assertMaxLength(name, MAX_NAME_LENGTH, key);
        names[key] = name;
      }
    }
    await ctx.db.insert("tenancySetups", {
      mode: args.mode,
      state: "running",
      step: "plans",
      cursor: null,
      ...(shared ? { billingUserId: args.billingUserId, adminUserId: args.adminUserId, ...names } : {}),
      startedAt: Date.now(),
      startedBy: ctx.user._id,
    });
    await ctx.scheduler.runAfter(0, internal.platform.tenancy.runSetup, {});
  },
});

/** One organization gets its plan; individuals also its billing row, named as the plan's payer. */
async function preparePlan(ctx: MutationCtx, organization: Doc<"organization">, mode: TenancyMode, planId: string, actor: Actor) {
  const current = await ctx.runQuery(components.platform.billing.currentPlan, { organizationId: organization._id });
  if (mode === "organizations") {
    if (!current) await ctx.runMutation(components.platform.billing.startPlan, { organizationId: organization._id, organizationName: organization.name, planId, actor });
    return;
  }
  const existing = await ctx.runQuery(components.platform.billing.billingByOrganization, { organizationId: organization._id });
  const billingOrganizationId = existing && !existing.deletedAt ? existing._id
    : await ctx.runMutation(components.platform.billing.createBilling, { organizationId: organization._id, organizationName: organization.name, actor });
  if (current?.row.billingOrganizationId) return;
  await ctx.runMutation(components.platform.billing.startPlan, {
    organizationId: organization._id, organizationName: organization.name, planId: current?.plan._id ?? planId, billingOrganizationId, actor,
  });
}

/** One batch of the running setup; schedules the next until the mode is on. */
export const runSetup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const setup = await currentSetup(ctx);
    if (!setup || setup.state !== "running") return;
    const actor = setup.startedBy ? { userId: setup.startedBy, email: (await findById(ctx, "user", setup.startedBy))?.email ?? "admin" } : SYSTEM_ACTOR;
    const planId = await initialPlanId(ctx);

    if (setup.step === "plans") {
      const result = await page<Doc<"organization">>(ctx, "organization", setup.cursor);
      for (const organization of result.page) await preparePlan(ctx, organization, setup.mode, planId, actor);
      const next = result.isDone ? (setup.billingUserId ? "shared" : "done") : "plans";
      await ctx.db.patch(setup._id, { step: next, cursor: result.isDone ? null : result.continueCursor });
    } else if (setup.step === "shared") {
      let { billingOrganizationId, sharedOrganizationId } = setup;
      if (!billingOrganizationId || !sharedOrganizationId) {
        billingOrganizationId = await createOrganizationWithOwner(ctx, setup.billingOrganizationName!, setup.billingUserId!);
        const billingRow = await ctx.runMutation(components.platform.billing.createBilling, {
          organizationId: billingOrganizationId, organizationName: setup.billingOrganizationName!, actor,
        });
        sharedOrganizationId = await createOrganizationWithOwner(ctx, setup.sharedOrganizationName!, setup.adminUserId!);
        await ctx.runMutation(components.platform.billing.startPlan, {
          organizationId: sharedOrganizationId, organizationName: setup.sharedOrganizationName!, planId, billingOrganizationId: billingRow, actor,
        });
        for (const organizationId of [billingOrganizationId, sharedOrganizationId]) {
          await scheduleAuditEvent(ctx, { actor: actor.email, authenticatedUserId: actor.userId, sourceDetail: "tenancy-setup", action: "organization.created", resource: `organization:${organizationId}`, status: "succeeded" });
        }
        await ctx.db.patch(setup._id, { billingOrganizationId, sharedOrganizationId });
      }
      const result = await page<Doc<"user">>(ctx, "user", setup.cursor);
      const now = Date.now();
      for (const user of result.page) {
        if (user.role === "admin" || !canAct(user) || user._id === setup.adminUserId) continue;
        const memberships = await listMemberships(ctx, user._id);
        if (memberships.length >= MAX_MEMBERSHIPS_PER_USER || memberships.some((m) => m.organizationId === sharedOrganizationId)) continue;
        await ctx.runMutation(components.betterAuth.adapter.create, {
          input: { model: "member", data: { organizationId: sharedOrganizationId, userId: user._id, role: "member", createdAt: now } },
        });
      }
      await ctx.db.patch(setup._id, { step: result.isDone ? "done" : "shared", cursor: result.isDone ? null : result.continueCursor });
    } else {
      await ctx.runMutation(components.platform.appSettings.putRaw, { key: TENANCY_MODE_KEY, value: setup.mode, updatedBy: setup.startedBy });
      await ctx.db.patch(setup._id, { state: "done", finishedAt: Date.now() });
      await scheduleAuditEvent(ctx, {
        actor: actor.email, authenticatedUserId: actor.userId, sourceDetail: "tenancy-setup", action: "tenancy.configured",
        resource: "tenancy", status: "succeeded", newValue: setup.mode,
        meta: JSON.stringify({ sharedOrganizationId: setup.sharedOrganizationId, billingOrganizationId: setup.billingOrganizationId }),
      });
      return;
    }
    await ctx.scheduler.runAfter(0, internal.platform.tenancy.runSetup, {});
  },
});

/**
 * Local development and E2E fixtures only: organizations mode with an inactive paid plan, so new
 * fixture users skip the plan picker. Idempotent; leaves an existing choice alone.
 */
export const ensureFixtureTenancy = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertLocalFixtures();
    if (await readTenancyMode(ctx)) return;
    await ctx.runMutation(components.platform.billing.ensureSeeded, {});
    const plans = await ctx.runQuery(components.platform.billing.listPlans, {});
    if (!plans.some((plan) => !plan.isSeeded)) {
      const pro = await ctx.runMutation(components.platform.billing.createPlan, { name: "Pro", priceMonthlyUsdCents: 1_900, isFreeForever: false, actor: SYSTEM_ACTOR });
      await ctx.runMutation(components.platform.billing.updatePlan, { planId: pro, status: "inactive", actor: SYSTEM_ACTOR });
    }
    const planId = await initialPlanId(ctx);
    let cursor: string | null = null;
    do {
      const result: Page<Doc<"organization">> = await page<Doc<"organization">>(ctx, "organization", cursor, 200);
      for (const organization of result.page) await preparePlan(ctx, organization, "organizations", planId, SYSTEM_ACTOR);
      cursor = result.isDone ? null : result.continueCursor;
    } while (cursor);
    await ctx.runMutation(components.platform.appSettings.putRaw, { key: TENANCY_MODE_KEY, value: "organizations", updatedBy: "fixture" });
  },
});

