import { delegationProof } from "./agentProof";
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
    step: v.union(v.literal("plans"), v.literal("shared"), v.literal("done")),
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
  }),

  // A user's own deletion request during its grace period (userDeletion.ts).
  userDeletions: defineTable({
    userId: v.string(),
    requestId: v.optional(v.string()),
    requestedAt: v.number(),
    deleteAt: v.number(),
    jobId: v.id("_scheduled_functions"),
    state: v.union(v.literal("scheduled"), v.literal("deleting"), v.literal("blocked")),
    blockedReason: v.optional(v.string()),
  }).index("by_user", ["userId"]).index("by_deleteAt", ["deleteAt"]),

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
