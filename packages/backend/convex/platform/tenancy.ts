import { refuse } from "@web-app-starter/convex-platform/errors";
/**
 * Tenancy mode: the platform admin chooses `individuals` or `organizations` once
 * (platform/docs/tenancy-and-billing.md). Until a setup finishes, sign-ups and organization
 * creation are refused (`TENANCY_NOT_CONFIGURED`); existing users keep working. Turning a mode
 * on runs in batches: every organization gets its plan (and, for individuals, its billing row),
 * and for organizations on an install with users only, a billing organization and one shared
 * organization with every user are created.
 */
import { createFunctionHandle } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery, query } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import type { Doc as AppDoc } from "../_generated/dataModel";
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
import { createOrganizationWithOwner, findById, findMembership, firstMembers, listMemberships, MAX_MEMBERSHIPS_PER_USER } from "./organizationAccess";
import { canAct, canActNow, hasActiveOwner, setMemberRole } from "./organizationOwnership";
import { assertLocalFixtures } from "./localFixtures";
import { batchLimits, isCurrentRun, jobStale, newRunId } from "./backgroundJobs";
import { assertMaxLength, MAX_NAME_LENGTH } from "@web-app-starter/convex-platform/validation";

type Reader = Pick<QueryCtx, "runQuery" | "db">;
type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

/** Organizations or users handled per setup step; each step is one transaction. */
const SETUP_BATCH = 50;
/** Users and organizations read to decide eligibility: a mode is turned on for fresh or small installs. */
const ELIGIBILITY_LIMIT = 2_000;

const modeValidator = v.union(v.literal("individuals"), v.literal("organizations"));

function requireAdmin(user: Doc<"user">) {
  if (user.role !== "admin") refuse("NOT_ADMIN");
}

async function page<T>(ctx: Reader, model: "organization" | "user", cursor: string | null, numItems = SETUP_BATCH): Promise<Page<T>> {
  return await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model,
    paginationOpts: { numItems, cursor },
  }) as Page<T>;
}

async function currentSetup(ctx: Pick<QueryCtx, "db">) {
  return await ctx.db.query("tenancySetups").order("desc").first();
}

/**
 * Who is still to become a platform administrator: the addresses `requiresEnrollment` recognizes
 * (protected admin addresses and admin invitations), read once rather than per user. Such a user
 * is not an application user: setup never picks them as an owner nor adds them as a member.
 */
async function pendingEnrollees(ctx: Reader): Promise<(email: string) => boolean> {
  const normalize = (email: string) => email.trim().toLowerCase();
  const emails = new Set((await ctx.runQuery(components.platform.adminEmails.list, {})).map((row) => normalize(row.email)));
  let cursor: string | null = null;
  do {
    const result: Page<{ email: string }> = await ctx.runQuery(components.platform.adminInvitations.list, { paginationOpts: { numItems: 200, cursor } });
    for (const row of result.page) emails.add(normalize(row.email));
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return (email) => emails.has(normalize(email));
}

/** A setup owner: an application user who can act and isn't a pending administrator. */
async function requireSetupUser(ctx: Reader, userId: string | undefined, enrollee?: (email: string) => boolean) {
  const user = userId ? await findById(ctx, "user", userId) : null;
  if (!user || !(await canActNow(ctx, user)) || (enrollee ?? await pendingEnrollees(ctx))(user.email)) refuse("TENANCY_USER_REQUIRED");
  return user;
}

/** Check enough room for both new owners before starting or resuming a batch. */
async function requireSetupOwners(ctx: Reader, billingUserId?: string, adminUserId?: string) {
  const needed = new Map<string, number>();
  const enrollee = await pendingEnrollees(ctx);
  for (const userId of [billingUserId, adminUserId]) {
    const user = await requireSetupUser(ctx, userId, enrollee);
    needed.set(user._id, (needed.get(user!._id) ?? 0) + 1);
  }
  for (const [userId, count] of needed) {
    if ((await listMemberships(ctx, userId)).length + count > MAX_MEMBERSHIPS_PER_USER) refuse("MEMBERSHIP_LIMIT_REACHED");
  }
}

/** Membership triggers read this inside the write transaction, including during setup. */
export const membershipMode = internalQuery({
  args: {},
  handler: async ctx => {
    const mode = await readTenancyMode(ctx);
    const setup = await currentSetup(ctx);
    return mode ?? (setup && setup.state !== "done" ? setup.mode : null);
  },
});

/** Schedule the setup's next batch and record its job on the row (backgroundJobs.ts). */
async function scheduleSetupRun(ctx: Pick<MutationCtx, "db" | "scheduler">, setup: AppDoc<"tenancySetups">, patch: Partial<AppDoc<"tenancySetups">> = {}) {
  const runId = patch.runId ?? setup.runId;
  const jobId = await ctx.scheduler.runAfter(0, internal.platform.tenancy.advanceSetup, { runId });
  await ctx.db.patch(setup._id, { ...patch, jobId, updatedAt: Date.now() });
}

/**
 * The setup driver: a scheduled mutation, which Convex runs exactly once. It runs one batch
 * (`runSetup`) as a sub-transaction and records a failure in its own transaction: a failed
 * batch's writes roll back and the setup is left `failed`, never `running` with nothing
 * scheduled. The batch gets most of the transaction's limits, so exceeding them is a failure
 * this records. Only a run of the setup's current chain (`runId`) does anything.
 */
export const advanceSetup = internalMutation({
  args: { runId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const setup = await currentSetup(ctx);
    if (!setup || setup.state !== "running" || !isCurrentRun(setup, args.runId)) return;
    const transactionLimits = await batchLimits(ctx);
    try {
      await ctx.runMutation(internal.platform.tenancy.runSetup, {}, transactionLimits ? { transactionLimits } : {});
    } catch (error) {
      await ctx.db.patch(setup._id, { state: "failed", error: (error instanceof Error ? error.message : "Setup failed").slice(0, 1000), updatedAt: Date.now() });
    }
  },
});

/** Whether a `running` setup is stuck: its batch can no longer run or record its outcome (backgroundJobs.ts). */
async function setupStale(ctx: Pick<QueryCtx, "db">, setup: AppDoc<"tenancySetups">): Promise<boolean> {
  return setup.state === "running" && await jobStale(ctx, setup, setup.updatedAt ?? setup.startedAt);
}

/**
 * Whether the shared organization of a setup that has created it lost every owner who can act
 * (banned, made an administrator, or deleted with it) since: `retry` may then name a new owner.
 */
async function sharedOwnerLost(ctx: Reader, setup: AppDoc<"tenancySetups">): Promise<boolean> {
  if (!setup.sharedOrganizationId) return false;
  if (!(await findById(ctx, "organization", setup.sharedOrganizationId))) return true;
  return !(await hasActiveOwner(ctx, setup.sharedOrganizationId));
}

/**
 * Make `adminUserId` the shared organization's owner, alongside any owner who can't act, or
 * recreate the organization (on its plan and payer, if the payer is still there) when it was
 * deleted. A recreated organization's member batches start again.
 */
async function replaceSharedOwner(ctx: MutationCtx & { user: Doc<"user"> }, setup: AppDoc<"tenancySetups">, adminUserId: string) {
  const user = await requireSetupUser(ctx, adminUserId);
  const actor = { userId: ctx.user._id, email: ctx.user.email };
  const sharedOrganizationId = setup.sharedOrganizationId!;
  const existing = await findById(ctx, "organization", sharedOrganizationId);
  const member = existing ? await findMembership(ctx, user._id, sharedOrganizationId) : null;
  if (!member && (await listMemberships(ctx, user._id)).length + 1 > MAX_MEMBERSHIPS_PER_USER) refuse("MEMBERSHIP_LIMIT_REACHED");
  if (!existing) {
    const organizationId = await createOrganizationWithOwner(ctx, setup.sharedOrganizationName!, user._id);
    const billing = setup.billingOrganizationId ? await ctx.runQuery(components.platform.billing.billingByOrganization, { organizationId: setup.billingOrganizationId }) : null;
    await ctx.runMutation(components.platform.billing.startPlan, {
      organizationId, organizationName: setup.sharedOrganizationName!, planId: await initialPlanId(ctx),
      ...(billing && !billing.deletedAt ? { billingOrganizationId: billing._id } : {}), actor,
    });
    await scheduleAuditEvent(ctx, { actor: actor.email, authenticatedUserId: actor.userId, sourceDetail: "tenancy-setup", action: "organization.created", resource: `organization:${organizationId}`, status: "succeeded", meta: JSON.stringify({ replaces: sharedOrganizationId }) });
    await ctx.db.patch(setup._id, { sharedOrganizationId: organizationId, ...(setup.step === "shared" ? { cursor: null } : {}) });
    return;
  }
  if (member) await setMemberRole(ctx, member._id, "owner");
  else {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "member", data: { organizationId: sharedOrganizationId, userId: user._id, role: "owner", createdAt: Date.now() } },
      onCreateHandle: await createFunctionHandle(internal.platform.authTriggers.onCreate),
    });
  }
  await scheduleAuditEvent(ctx, { actor: actor.email, authenticatedUserId: actor.userId, sourceDetail: "tenancy-setup", action: "admin.organization.owner_added", resource: `organization:${sharedOrganizationId}`, status: "succeeded", meta: JSON.stringify({ userId: user._id, reason: "tenancy_setup_retry" }) });
}

/**
 * Retry the same batch after correcting its reported prerequisite; completed work is retained.
 * Accepts a failed setup, and a stale one (still `running`, but its batch can no longer run).
 * Owners can be replaced until the billing and shared organizations exist; after that, only a
 * new `adminUserId`, and only while the shared organization has no owner who can act.
 */
export const retry = adminMutation({
  args: { billingUserId: v.optional(v.string()), adminUserId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireAdmin(ctx.user);
    const setup = await currentSetup(ctx);
    if (!setup || (setup.state !== "failed" && !(await setupStale(ctx, setup)))) refuse("TENANCY_SETUP_NOT_FAILED");
    const ownersCreated = !!(setup.billingOrganizationId || setup.sharedOrganizationId);
    if (ownersCreated && (args.billingUserId || (args.adminUserId && !(await sharedOwnerLost(ctx, setup))))) refuse("TENANCY_SETUP_OWNERS_FIXED");
    if (ownersCreated && args.adminUserId) await replaceSharedOwner(ctx, setup, args.adminUserId);
    const billingUserId = args.billingUserId ?? setup.billingUserId;
    const adminUserId = args.adminUserId ?? setup.adminUserId;
    if (billingUserId && !ownersCreated) await requireSetupOwners(ctx, billingUserId, adminUserId);
    // A new run token: a late run of the stopped chain does nothing.
    await scheduleSetupRun(ctx, setup, { state: "running", error: undefined, billingUserId, adminUserId, runId: newRunId() });
  },
});

// ---------------------------------------------------------------------------
// The eligibility check: a stored, batched scan
// ---------------------------------------------------------------------------

type CheckRow = AppDoc<"tenancyChecks">;

/**
 * How long a finished check stands for the install: `configure` refuses an older one
 * (`TENANCY_CHECK_EXPIRED`) and the admin page runs a new one. Before a mode is chosen, sign-ups
 * and organization creation are refused, so what a check counts changes rarely; changes come
 * from many paths (Better Auth's endpoints, admin actions, deletions, invitations), so a short
 * age bounds them more reliably than a change counter every path would have to keep. What can
 * change within it is re-checked where it matters: `configure` re-reads the plans and the
 * owners it is given, and an individuals setup re-checks every organization and user in its own
 * batches while its member trigger refuses new shared memberships.
 */
export const CHECK_FRESH_MS = 10 * 60 * 1000;
/** Users or organizations read per check batch; each batch is one transaction. */
const CHECK_BATCH = 100;
/** Candidate owners a check keeps for the admin page's pickers. */
const MAX_CANDIDATES = 200;

async function currentCheck(ctx: Pick<QueryCtx, "db">): Promise<CheckRow | null> {
  return await ctx.db.query("tenancyChecks").order("desc").first();
}

/** Schedule the check's next batch and record its job (backgroundJobs.ts). */
async function scheduleCheckRun(ctx: Pick<MutationCtx, "db" | "scheduler">, check: CheckRow, patch: Partial<CheckRow> = {}) {
  const runId = patch.runId ?? check.runId;
  const batch = patch.batches ?? check.batches;
  const jobId = await ctx.scheduler.runAfter(0, internal.platform.tenancy.advanceCheck, { runId, batch });
  await ctx.db.patch(check._id, { ...patch, jobId, updatedAt: Date.now() });
}

/** Whether a `running` check is stuck: its batch can no longer run or record its outcome (backgroundJobs.ts). */
async function checkStale(ctx: Pick<QueryCtx, "db">, check: CheckRow): Promise<boolean> {
  return check.state === "running" && await jobStale(ctx, check, check.updatedAt);
}

/** Whether a finished check still stands (`CHECK_FRESH_MS`). */
function checkFresh(check: CheckRow | null, now = Date.now()): check is CheckRow & { finishedAt: number } {
  return !!check && check.state === "done" && !!check.finishedAt && check.finishedAt >= now - CHECK_FRESH_MS;
}

/**
 * Check whether a tenancy mode can be turned on: starts a batched scan of every user and
 * organization (`advanceCheck`), or does nothing while one is running. `status` reports its
 * progress and result; `configure` needs a fresh one.
 */
export const check = adminMutation({
  args: {},
  handler: async (ctx) => {
    requireAdmin(ctx.user);
    if (await readTenancyMode(ctx)) refuse("TENANCY_ALREADY_CONFIGURED");
    const setup = await currentSetup(ctx);
    if (setup && setup.state !== "done") refuse("TENANCY_SETUP_RUNNING");
    const existing = await currentCheck(ctx);
    if (existing && existing.state === "running" && !(await checkStale(ctx, existing))) return;
    const now = Date.now();
    const fresh = {
      state: "running" as const, phase: "users" as const, cursor: null, batches: 0, users: 0, organizations: 0,
      appUserCount: 0, usersWithoutOneOrganization: 0, sharedOrganizations: 0, candidates: [], complete: true,
      startedAt: now, startedBy: ctx.user._id, updatedAt: now, finishedAt: undefined, error: undefined, runId: newRunId(),
    };
    if (existing) await ctx.db.patch(existing._id, fresh);
    const id = existing?._id ?? await ctx.db.insert("tenancyChecks", fresh);
    await scheduleCheckRun(ctx, (await ctx.db.get(id))!);
  },
});

/**
 * The check's driver, like `advanceSetup`: one batch (`runCheck`) as a sub-transaction, a failure
 * recorded in its own transaction. Only the run of the check's current chain (`runId`) and its
 * next batch (`batch`) does anything: a repeated delivery would count a batch twice.
 */
export const advanceCheck = internalMutation({
  args: { runId: v.optional(v.string()), batch: v.number() },
  handler: async (ctx, args) => {
    const row = await currentCheck(ctx);
    if (!row || row.state !== "running" || !isCurrentRun(row, args.runId) || row.batches !== args.batch) return;
    const transactionLimits = await batchLimits(ctx);
    try {
      await ctx.runMutation(internal.platform.tenancy.runCheck, {}, transactionLimits ? { transactionLimits } : {});
    } catch (error) {
      await ctx.db.patch(row._id, { state: "failed", error: (error instanceof Error ? error.message : "Check failed").slice(0, 1000), updatedAt: Date.now() });
    }
  },
});

async function membershipCount(ctx: Reader, userId: string, upTo: number): Promise<number> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "member", where: [{ field: "userId", value: userId }], paginationOpts: { numItems: upTo, cursor: null },
  });
  return result.page.length;
}

/** Whether a user is an application user (not a platform administrator or one still enrolling). */
function isAppUser(user: Doc<"user">, enrollee: (email: string) => boolean): boolean {
  return user.role !== "admin" && !enrollee(user.email);
}

/**
 * One batch of the running check: up to `CHECK_BATCH` users (application users, candidates, and
 * those without exactly one organization, reading at most two memberships each), then
 * organizations (shared ones, reading at most two members each). Stops, incomplete, past
 * `ELIGIBILITY_LIMIT` of either. Schedules the next batch until done.
 */
export const runCheck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const row = await currentCheck(ctx);
    if (!row || row.state !== "running") return;
    const patch: Partial<CheckRow> = { batches: row.batches + 1 };
    if (row.phase === "users") {
      const result = await page<Doc<"user">>(ctx, "user", row.cursor, CHECK_BATCH);
      const enrollee = await pendingEnrollees(ctx);
      let { appUserCount, usersWithoutOneOrganization } = row;
      const candidates = [...row.candidates];
      for (const user of result.page) {
        if (!isAppUser(user, enrollee)) continue;
        appUserCount++;
        if (await canActNow(ctx, user) && candidates.length < MAX_CANDIDATES) candidates.push({ id: user._id, name: user.name ?? "", email: user.email });
        if ((await membershipCount(ctx, user._id, 2)) !== 1) usersWithoutOneOrganization++;
      }
      const users = row.users + result.page.length;
      Object.assign(patch, { users, appUserCount, usersWithoutOneOrganization, candidates });
      if (users > ELIGIBILITY_LIMIT) Object.assign(patch, { complete: false, phase: "done" as const });
      else Object.assign(patch, result.isDone ? { phase: "organizations" as const, cursor: null } : { cursor: result.continueCursor });
    } else if (row.phase === "organizations") {
      const result = await page<Doc<"organization">>(ctx, "organization", row.cursor, CHECK_BATCH);
      let { sharedOrganizations } = row;
      for (const organization of result.page) {
        if ((await firstMembers(ctx, organization._id, 2)).length > 1) sharedOrganizations++;
      }
      const organizations = row.organizations + result.page.length;
      Object.assign(patch, { organizations, sharedOrganizations });
      if (organizations > ELIGIBILITY_LIMIT) Object.assign(patch, { complete: false, phase: "done" as const });
      else Object.assign(patch, result.isDone ? { phase: "done" as const, cursor: null } : { cursor: result.continueCursor });
    }
    if (patch.phase === "done" || row.phase === "done") {
      await ctx.db.patch(row._id, { ...patch, phase: "done", state: "done", finishedAt: Date.now(), updatedAt: Date.now() });
      return;
    }
    await scheduleCheckRun(ctx, row, patch);
  },
});

/** What the platform admin needs to decide, from a finished check and the current plans. */
async function eligibilityFrom(ctx: Reader, check: CheckRow) {
  const plans = await ctx.runQuery(components.platform.billing.listPlans, {});
  const defaultPlan = plans.find((plan) => plan.isDefault) ?? null;
  const otherPlans = plans.filter((plan) => !plan.isSeeded).length;
  const plansReady = otherPlans > 0 && !!defaultPlan && defaultPlan.isFreeForever && defaultPlan.status === "active";
  return {
    complete: check.complete,
    appUserCount: check.appUserCount,
    candidates: check.candidates,
    sharedOrganizations: check.sharedOrganizations,
    plans: { otherPlans, defaultPlan: defaultPlan ? { id: defaultPlan._id, name: defaultPlan.name, isFreeForever: defaultPlan.isFreeForever, status: defaultPlan.status } : null, ready: plansReady },
    individualsAllowed: check.complete && check.sharedOrganizations === 0 && check.usersWithoutOneOrganization === 0,
    /** Organizations mode creates a shared organization only on an install with users and no shared organizations. */
    sharedStep: check.complete && check.appUserCount > 0 && check.sharedOrganizations === 0,
  };
}

/** The check as the admin page shows it: progress while running, when it stops standing once done. */
async function checkView(ctx: Pick<QueryCtx, "db">, check: CheckRow | null) {
  if (!check) return null;
  return {
    state: check.state,
    phase: check.phase,
    users: check.users,
    organizations: check.organizations,
    startedAt: check.startedAt,
    finishedAt: check.finishedAt ?? null,
    /** After this, `configure` refuses the result: run `check` again. */
    freshUntil: check.finishedAt ? check.finishedAt + CHECK_FRESH_MS : null,
    stale: await checkStale(ctx, check),
    error: check.error ?? null,
  };
}

/** The mode, for every app: decides which organization and billing screens exist. */
export const mode = query({
  args: {},
  handler: async (ctx) => ({ mode: await readTenancyMode(ctx) }),
});

/**
 * The admin app's tenancy page: the chosen mode, or what choosing one needs. It reads the stored
 * check (`check`) and the plans, never every user: `eligibility` is `null` until a check has
 * finished, and `check` says how far one has got and until when its result stands.
 */
export const status = authedQuery({
  args: {},
  handler: async (ctx) => {
    requireAdmin(ctx.user);
    const mode = await readTenancyMode(ctx);
    const setup = await currentSetup(ctx);
    const failed = setup?.state === "failed";
    /** Still `running`, but its batch can no longer run: retry it like a failed one. */
    const stale = !!setup && await setupStale(ctx, setup);
    const running = setup && setup.state !== "done" ? {
      mode: setup.mode, step: setup.step, startedAt: setup.startedAt, failed, stale,
      canReplaceOwners: !setup.billingOrganizationId && !setup.sharedOrganizationId,
      /** The shared organization exists but has no owner who can act: retry with a new `adminUserId`. */
      canReplaceAdmin: (failed || stale) && await sharedOwnerLost(ctx, setup),
      error: setup.error ?? null,
    } : null;
    if (mode) return { mode, running: null, eligibility: null, check: null };
    const stored = await currentCheck(ctx);
    const eligibility = stored?.state === "done" && !(running && !running.failed && !running.stale) ? await eligibilityFrom(ctx, stored) : null;
    return { mode: null, running, eligibility, check: await checkView(ctx, stored) };
  },
});

/**
 * Turn on a mode, against a fresh check (`check`, at most `CHECK_FRESH_MS` old:
 * `TENANCY_CHECK_REQUIRED`, `TENANCY_CHECK_EXPIRED`); the plans and owners are read again here.
 * Needs a plan besides the seeded one and a free-forever default. Individuals:
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
    if (await readTenancyMode(ctx)) refuse("TENANCY_ALREADY_CONFIGURED");
    const previous = await currentSetup(ctx);
    if (previous && previous.state !== "done") refuse("TENANCY_SETUP_RUNNING");
    const stored = await currentCheck(ctx);
    if (!stored || stored.state !== "done") refuse("TENANCY_CHECK_REQUIRED");
    if (!checkFresh(stored)) refuse("TENANCY_CHECK_EXPIRED");
    await ctx.runMutation(components.platform.billing.ensureSeeded, {});
    const check = await eligibilityFrom(ctx, stored);
    if (!check.complete) refuse("TENANCY_INSTALL_TOO_LARGE");
    if (!check.plans.ready) refuse("TENANCY_PLANS_REQUIRED");
    if (args.mode === "individuals" && !check.individualsAllowed) refuse("TENANCY_INDIVIDUALS_NOT_ALLOWED");
    const shared = args.mode === "organizations" && check.sharedStep;
    const names: { billingOrganizationName?: string; sharedOrganizationName?: string } = {};
    if (shared) {
      await requireSetupOwners(ctx, args.billingUserId, args.adminUserId);
      for (const key of ["billingOrganizationName", "sharedOrganizationName"] as const) {
        const name = args[key]?.trim();
        if (!name) refuse("ORGANIZATION_NAME_REQUIRED");
        assertMaxLength(name, MAX_NAME_LENGTH, key);
        names[key] = name;
      }
    }
    const id = await ctx.db.insert("tenancySetups", {
      runId: newRunId(),
      mode: args.mode,
      state: "running",
      step: "plans",
      cursor: null,
      ...(shared ? { billingUserId: args.billingUserId, adminUserId: args.adminUserId, ...names } : {}),
      startedAt: Date.now(),
      startedBy: ctx.user._id,
    });
    await scheduleSetupRun(ctx, (await ctx.db.get(id))!);
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

/**
 * One batch of the running setup; schedules the next until the mode is on. Runs only inside
 * `advanceSetup`, which checks the run token and records a failure.
 */
export const runSetup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const setup = await currentSetup(ctx);
    if (!setup || setup.state !== "running") return;
    if (setup.billingUserId && (!setup.billingOrganizationId || !setup.sharedOrganizationId)) await requireSetupOwners(ctx, setup.billingUserId, setup.adminUserId);
    const plans = await ctx.runQuery(components.platform.billing.listPlans, {});
    if (!plans.some(plan => !plan.isSeeded) || !plans.some(plan => plan.isDefault && plan.isFreeForever && plan.status === "active")) refuse("TENANCY_PLANS_REQUIRED");
    const actor = setup.startedBy ? { userId: setup.startedBy, email: (await findById(ctx, "user", setup.startedBy))?.email ?? "admin" } : SYSTEM_ACTOR;
    const planId = await initialPlanId(ctx);

    if (setup.step === "plans") {
      const result = await page<Doc<"organization">>(ctx, "organization", setup.cursor);
      for (const organization of result.page) {
        // Individuals: every organization still has one member (joins are refused meanwhile).
        if (setup.mode === "individuals" && (await firstMembers(ctx, organization._id, 2)).length > 1) refuse("TENANCY_INDIVIDUALS_NOT_ALLOWED");
        await preparePlan(ctx, organization, setup.mode, planId, actor);
      }
      const next = result.isDone ? (setup.billingUserId ? "shared" : setup.mode === "individuals" ? "verify" : "done") : "plans";
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
      const enrollee = await pendingEnrollees(ctx);
      for (const user of result.page) {
        if (user.role === "admin" || !canAct(user) || enrollee(user.email) || user._id === setup.adminUserId) continue;
        const memberships = await listMemberships(ctx, user._id);
        if (memberships.length >= MAX_MEMBERSHIPS_PER_USER || memberships.some((m) => m.organizationId === sharedOrganizationId)) continue;
        await ctx.runMutation(components.betterAuth.adapter.create, {
          input: { model: "member", data: { organizationId: sharedOrganizationId, userId: user._id, role: "member", createdAt: now } },
          onCreateHandle: await createFunctionHandle(internal.platform.authTriggers.onCreate),
        });
      }
      await ctx.db.patch(setup._id, { step: result.isDone ? "done" : "shared", cursor: result.isDone ? null : result.continueCursor });
    } else if (setup.step === "verify") {
      // Individuals: every application user still has exactly one organization, a batch at a time.
      const result = await page<Doc<"user">>(ctx, "user", setup.cursor);
      const enrollee = await pendingEnrollees(ctx);
      for (const user of result.page) {
        if (isAppUser(user, enrollee) && (await membershipCount(ctx, user._id, 2)) !== 1) refuse("TENANCY_INDIVIDUALS_NOT_ALLOWED");
      }
      await ctx.db.patch(setup._id, { step: result.isDone ? "done" : "verify", cursor: result.isDone ? null : result.continueCursor });
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
    await scheduleSetupRun(ctx, (await ctx.db.get(setup._id))!);
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

