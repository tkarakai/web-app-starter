import { migrationTableValidator, migrationPhaseValidator } from "./migrationTables";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const auditTrailFields = {
  happenedAt: v.number(),
  authenticatedUserId: v.optional(v.string()),
  actor: v.string(),
  source: v.string(),
  action: v.string(),
  resource: v.string(),
  status: v.string(),
  oldValue: v.optional(v.string()),
  newValue: v.optional(v.string()),
  reason: v.optional(v.string()),
  meta: v.optional(v.string()),
  truncatedFields: v.optional(v.string()),
};

export const appSettingsFields = { key: v.string(), value: v.string(), updatedAt: v.number(), updatedBy: v.optional(v.string()) };

export const announcementFields = {
    name: v.string(),
    bannerText: v.string(),
    callToActionName: v.optional(v.string()),
    callToActionUrl: v.optional(v.string()),
    learnMoreName: v.optional(v.string()),
    learnMoreContent: v.optional(v.string()),
    scheduleStart: v.optional(v.number()),
    scheduleEnd: v.optional(v.number()),
    publishJobId: v.optional(v.id("_scheduled_functions")),
    unpublishJobId: v.optional(v.id("_scheduled_functions")),
    isLive: v.boolean(),
    isArchived: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.optional(v.string()),
    updatedBy: v.optional(v.string()),
};

export const waitlistEntriesFields = {
    invitationGeneration: v.optional(v.number()),
    email: v.string(),
    meta: v.string(), // App-owned JSON object, stored as a string
    status: v.union(
      v.literal("waiting"),
      v.literal("invited"),
      v.literal("claimed")
    ),
    invitedAt: v.optional(v.number()),
    invitationExpiresAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
  };

export const invitationTokensFields = {
    waitlistEntryId: v.id("waitlistEntries"),
    token: v.string(),
    email: v.string(),
    status: v.union(
      v.literal("sent"),
      v.literal("claiming"),
      v.literal("claimed"),
      v.literal("revoked")
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
    claimedAt: v.optional(v.number()),
    claimStartedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  };

export const adminInvitationsFields = {
    userId: v.optional(v.string()),
    email: v.string(),
    token: v.optional(v.string()),
    status: v.union(
      v.literal("invited"),
      v.literal("claimed"),
      v.literal("completed")
    ),
    onboardingStep: v.optional(v.number()),
    invitedAt: v.number(),
    invitationExpiresAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
  };

export const planStatusValidator = v.union(v.literal("active"), v.literal("inactive"), v.literal("archived"));
export const paymentMethodValidator = v.union(v.literal("cash"), v.literal("check"));

/** The plan catalog (platform/docs/tenancy-and-billing.md). Plans are never deleted. */
export const plansFields = {
  name: v.string(),
  /** Whole USD cents, at least 0. Can't change once any organization plan uses the plan. */
  priceMonthlyUsdCents: v.number(),
  /** The plan never charges; never changes after creation. */
  isFreeForever: v.boolean(),
  /** The free-forever plan seeded at install: only its status can change. */
  isSeeded: v.boolean(),
  /** Pre-selected in the plan picker. Exactly one, and it is active. */
  isDefault: v.boolean(),
  status: planStatusValidator,
  createdAt: v.number(),
  createdBy: v.string(),
  updatedAt: v.number(),
  updatedBy: v.optional(v.string()),
};

/** Marks an organization as a billing organization (a payer). Kept as billing history. */
export const billingOrganizationsFields = {
  /** Better Auth organization ID. One row per organization. */
  organizationId: v.string(),
  /** Copied when the row is created, so history stays readable after the organization is gone. */
  organizationName: v.string(),
  /** Stand-in until a payment provider is integrated. */
  paymentMethod: v.optional(paymentMethodValidator),
  createdAt: v.number(),
  deletedAt: v.optional(v.number()),
};

/** Which plan an organization uses and which billing organization pays. Rows are never edited for plan or payer. */
export const organizationPlansFields = {
  organizationId: v.string(),
  organizationName: v.string(),
  planId: v.id("plans"),
  /** Empty only when the plan is free-forever. */
  billingOrganizationId: v.optional(v.id("billingOrganizations")),
  createdAt: v.number(),
  /** Set when the plan or payer changes, or the organization is deleted; the current row has none. */
  endedAt: v.optional(v.number()),
};

export default defineSchema({
  plans: defineTable(plansFields).index("by_status", ["status"]).index("by_default", ["isDefault"]),
  billingOrganizations: defineTable(billingOrganizationsFields).index("by_organization", ["organizationId"]),
  organizationPlans: defineTable(organizationPlansFields)
    .index("by_organization", ["organizationId", "endedAt"])
    .index("by_billing_organization", ["billingOrganizationId", "endedAt"])
    .index("by_plan", ["planId"]),
  migrationState: defineTable({ name: v.string(), deployment: v.string(), phase: migrationPhaseValidator, startedAt: v.number(), verifiedAt: v.optional(v.number()), completedAt: v.optional(v.number()) }).index("by_name", ["name"]),
  migrationProgress: defineTable({ table: migrationTableValidator, cursor: v.union(v.string(), v.null()), complete: v.boolean() }).index("by_table", ["table"]),
  migrationRows: defineTable({ table: migrationTableValidator, legacyId: v.string(), componentId: v.string(), legacyCreationTime: v.number(), snapshot: v.string(), publishAt: v.optional(v.number()), unpublishAt: v.optional(v.number()), sourcePublishJobId: v.optional(v.string()), sourceUnpublishJobId: v.optional(v.string()), schedulesActivated: v.boolean() }).index("by_table_legacy", ["table", "legacyId"]).index("by_table", ["table"]).index("by_table_activated", ["table", "schedulesActivated"]),
  adminEnrollments: defineTable({
    email: v.string(), capabilityHash: v.string(), tokenHash: v.string(),
    expiresAt: v.number(), userId: v.optional(v.string()),
  }).index("by_capability", ["capabilityHash"]).index("by_expiresAt", ["expiresAt"]),
  adminEmails: defineTable({ email: v.string() }).index("by_email", ["email"]),
  adminInvitations: defineTable(adminInvitationsFields)
    .index("by_email", ["email"])
    .index("by_created", ["createdAt"])
    .index("by_token", ["token"]),
  invitationTokens: defineTable(invitationTokensFields)
    .index("by_token", ["token"])
    .index("by_email", ["email"])
    .index("by_waitlist_entry", ["waitlistEntryId"]),
  waitlistEntries: defineTable(waitlistEntriesFields)
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),
  appSettings: defineTable(appSettingsFields).index("by_key", ["key"]),
  announcements: defineTable(announcementFields)
    .index("by_isLive", ["isLive"])
    .index("by_scheduleEnd", ["scheduleEnd"])
    .index("by_updatedAt", ["updatedAt"]),
  auditTrail: defineTable({
    ...auditTrailFields,
    // Set only on rows copied from the app's legacy `auditTrail` table.
    // Holds the legacy document's `_id` (a plain string across the component
    // boundary) so the copy is idempotent and verifiable.
    legacyId: v.optional(v.string()),
    // The legacy row's `_creationTime`; component rows get a new one on insert.
    legacyCreationTime: v.optional(v.number()),
  })
    .index("by_happenedAt", ["happenedAt"])
    .index("by_action_happenedAt", ["action", "happenedAt"])
    .index("by_actor_happenedAt", ["actor", "happenedAt"])
    .index("by_source_happenedAt", ["source", "happenedAt"])
    .index("by_status_happenedAt", ["status", "happenedAt"])
    .index("by_action_status_happenedAt", ["action", "status", "happenedAt"])
    .index("by_authenticatedUserId_happenedAt", [
      "authenticatedUserId",
      "happenedAt",
    ])
    .index("by_legacyId", ["legacyId"]),
});
