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
