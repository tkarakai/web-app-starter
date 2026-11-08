import { delegationProof } from "./agentProof";
import { jobFields } from "./backgroundJobs";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { migrationsTable } from "convex-helpers/server/migrations";
import { rateLimitTables } from "convex-helpers/server/rateLimit";

/**
 * The platform's tables. The app's `convex/schema.ts` spreads them into its schema
 * (the platform hook); never define a table with one of these names yourself.
 */
export const platformTables = {
  ...rateLimitTables,

  // --- Migrations state (convex-helpers framework) ---
  migrations: migrationsTable,

  agentDelegations: defineTable({ userId: v.string(), expiresAt: v.number(), credentialFingerprint: v.string(), proof: delegationProof }),
  agentAuthorizationCodes: defineTable({
    generation: v.optional(v.string()), codeHash: v.string(), userId: v.string(), sessionId: v.optional(v.string()), delegationId: v.optional(v.id("agentDelegations")), clientId: v.string(),
    redirectUri: v.string(), resource: v.string(), challenge: v.string(), scope: v.string(), expiresAt: v.number(),
  }).index("by_code_hash", ["codeHash"]),
  agentGrants: defineTable({
    generation: v.optional(v.string()), tokenHash: v.string(), userId: v.string(), sessionId: v.optional(v.string()), delegationId: v.optional(v.id("agentDelegations")), clientId: v.string(),
    resource: v.string(), scope: v.string(), createdAt: v.number(), expiresAt: v.number(), revokedAt: v.optional(v.number()),
  }).index("by_token_hash", ["tokenHash"]).index("by_user", ["userId"]),

  agentTaskMessages: defineTable({ userId: v.string(), messageId: v.string(), taskId: v.id("agentTasks"), requestHash: v.string(), expiresAt: v.number() }).index("by_user_message", ["userId", "messageId"]).index("by_task", ["taskId"]),
  agentTasks: defineTable({ userId: v.string(), grantId: v.id("agentGrants"), resource: v.string(), generation: v.string(), contextId: v.string(), messageId: v.string(), requestHash: v.string(), command: v.optional(v.string()), state: v.string(), createdAt: v.number(), updatedAt: v.number(), expiresAt: v.number(), result: v.optional(v.string()), error: v.optional(v.string()) }).index("by_user", ["userId"]).index("by_user_message", ["userId", "messageId"]),

  // Removing a deleted organization's app data: progress, retries and outcome (organizations.ts).
  organizationCleanups: defineTable({
    organizationId: v.string(),
    state: v.union(v.literal("running"), v.literal("done"), v.literal("retained"), v.literal("failed")),
    attempts: v.number(),
    batches: v.number(),
    lastError: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
    ...jobFields,
  }).index("by_organization", ["organizationId"]).index("by_state", ["state", "updatedAt"]),

  // A user who must pick a plan before using the app (sign-up plan picker, billingAccess.ts).
  pendingPlanChoices: defineTable({
    userId: v.string(),
    organizationId: v.string(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Turning on a tenancy mode: progress of the batched setup (tenancy.ts).
  tenancySetups: defineTable({
    mode: v.union(v.literal("individuals"), v.literal("organizations")),
    state: v.union(v.literal("running"), v.literal("failed"), v.literal("done")),
    // `verify`: individuals only, every application user still has exactly one organization.
    step: v.union(v.literal("plans"), v.literal("shared"), v.literal("verify"), v.literal("done")),
    cursor: v.union(v.string(), v.null()),
    billingUserId: v.optional(v.string()),
    adminUserId: v.optional(v.string()),
    billingOrganizationName: v.optional(v.string()),
    sharedOrganizationName: v.optional(v.string()),
    billingOrganizationId: v.optional(v.string()),
    sharedOrganizationId: v.optional(v.string()),
    startedAt: v.number(),
    startedBy: v.string(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    // The pending `advanceSetup` run while `running` (backgroundJobs.ts).
    ...jobFields,
    updatedAt: v.optional(v.number()),
  }),

  // Whether a tenancy mode can be turned on: a batched scan of users and organizations whose
  // progress and result are stored; `tenancy.status` reads it, `configure` needs it fresh (tenancy.ts).
  tenancyChecks: defineTable({
    state: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
    phase: v.union(v.literal("users"), v.literal("organizations"), v.literal("done")),
    cursor: v.union(v.string(), v.null()),
    // Batches run; each scheduled run names the batch it is, so a repeated delivery does nothing.
    batches: v.number(),
    users: v.number(),
    organizations: v.number(),
    appUserCount: v.number(),
    usersWithoutOneOrganization: v.number(),
    sharedOrganizations: v.number(),
    candidates: v.array(v.object({ id: v.string(), name: v.string(), email: v.string() })),
    // False once the install has more users or organizations than a check reads.
    complete: v.boolean(),
    startedAt: v.number(),
    startedBy: v.string(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    ...jobFields,
  }),

  // A user's own deletion request during its grace period (userDeletion.ts).
  userDeletions: defineTable({
    userId: v.string(),
    requestId: v.optional(v.string()),
    requestedAt: v.number(),
    deleteAt: v.number(),
    jobId: v.id("_scheduled_functions"),
    state: v.union(v.literal("scheduled"), v.literal("deleting"), v.literal("cleanup_pending"), v.literal("blocked")),
    blockedReason: v.optional(v.string()),
    // While `deleting`: when it was claimed, and the token of an administrator's retry (backgroundJobs.ts).
    claimedAt: v.optional(v.number()),
    runId: v.optional(v.string()),
  }).index("by_user", ["userId"]).index("by_deleteAt", ["deleteAt"]),

  // What a deleted user still owes, recorded before the user row goes, and the job that clears it:
  // memberships one organization per run, then user data (userDeletion.ts, backgroundJobs.ts).
  userDeletionCleanups: defineTable({
    userId: v.string(), ownerId: v.string(), email: v.string(), name: v.string(),
    state: v.union(v.literal("pending"), v.literal("running"), v.literal("failed")),
    attempts: v.number(), createdAt: v.number(), error: v.optional(v.string()),
    // Who deleted the user, for organizations the deletion empties (default: the user).
    actor: v.optional(v.object({ email: v.string(), userId: v.optional(v.string()) })),
    // Memberships removed so far, and when the job last recorded progress.
    removedMemberships: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    ...jobFields,
  }).index("by_user", ["userId"]),

  userProfiles: defineTable({
    ownerId: v.string(),
    locale: v.optional(v.string()),
    theme: v.optional(v.string()),
    timezone: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),
};
