/** A buyer-owned invoice domain and a tenant agent job exercise the public migration seam. */
import { defineSchema, defineTable, internalMutationGeneric, type GenericMutationCtx, type DataModelFromSchemaDefinition } from "convex/server";
import { v } from "convex/values";
import schema from "../convex/schema";
import type { MutationCtx } from "../convex/_generated/server";
import { organizationMigrationRegistry } from "../convex/organizationMigrationRegistry";
import { organizationMigrationStages } from "../convex/organizationMigration";
import { beginOrganizationMigration, stepOrganizationMigration, finalizeOrganizationMigration, ownerMapping, preservePrivateOwnership, jobStage, type MigrationStage } from "../convex/platform/organizationMigration";
import { assertOrganizationWriteAllowed } from "../convex/platform/organizationReadiness";
export const customSchema = defineSchema({ ...schema.tables, invoices: defineTable({
  ownerId: v.string(), organizationId: v.optional(v.string()), amount: v.number(), shared: v.boolean(),
}) });
type CustomModel = DataModelFromSchemaDefinition<typeof customSchema>;
export const customRegistry = { ...organizationMigrationRegistry,
  tables: { ...organizationMigrationRegistry.tables, invoices: "private-root" as const },
  functions: { ...organizationMigrationRegistry.functions, "buyerTenantAgent:writeInvoice": "tenant" as const },
  jobs: { ...organizationMigrationRegistry.jobs, "buyerTenantAgent:writeInvoice": "drain" as const },
};
// Convex contexts differ only in the extended schema; platform code addresses only platform tables.
const platformCtx = (ctx: GenericMutationCtx<CustomModel>) => ctx as unknown as MutationCtx;
const invoiceStage: MigrationStage = { name: "invoices", async run(ctx, cursor, size, verify) {
  const db = (ctx as unknown as GenericMutationCtx<CustomModel>).db;
  const page = await db.query("invoices").paginate({ cursor, numItems: size });
  for (const row of page.page) {
    if (row.shared) throw new Error(`BUYER_SHARED_INVOICE_REQUIRES_REVIEW:${row._id}`);
    const mapping = await ownerMapping(ctx, row.ownerId);
    const organizationId = row.organizationId ?? mapping.organizationId;
    if (!organizationId) throw new Error("BUYER_INVOICE_OWNER_UNRESOLVED");
    if (verify && !row.organizationId) throw new Error("BUYER_INVOICE_UNMIGRATED");
    await preservePrivateOwnership(ctx, { source: "invoices", sourceId: row._id, ownerId: row.ownerId,
      organizationId, wasTagged: Boolean(row.organizationId), creationTime: row._creationTime }, verify);
    if (!row.organizationId) {
      await db.patch(row._id, { organizationId });
    }
  }
  return { count: page.page.length, done: page.isDone, cursor: page.continueCursor };
} };
const stages = [...organizationMigrationStages.slice(0, -1), invoiceStage, jobStage(customRegistry)];
export const customFunctions = {
  begin: internalMutationGeneric({ args: { confirmDeployment: v.string(), deploymentVersion: v.string() }, handler: (ctx: GenericMutationCtx<CustomModel>, args) => beginOrganizationMigration(platformCtx(ctx), customRegistry, args) }),
  step: internalMutationGeneric({ args: {}, handler: (ctx: GenericMutationCtx<CustomModel>) => stepOrganizationMigration(platformCtx(ctx), customRegistry, stages, 1) }),
  finalize: internalMutationGeneric({ args: {}, handler: (ctx: GenericMutationCtx<CustomModel>) => finalizeOrganizationMigration(platformCtx(ctx), customRegistry, stages) }),
  writeInvoice: internalMutationGeneric({ args: { ownerId: v.string(), organizationId: v.optional(v.string()), epoch: v.number() }, handler: async (ctx: GenericMutationCtx<CustomModel>, args) => {
    await assertOrganizationWriteAllowed(platformCtx(ctx), "tenant");
    if (args.epoch !== 2 || !args.organizationId) throw new Error("BUYER_OLD_QUEUED_AUTHORITY");
    const mapping = await ownerMapping(platformCtx(ctx), args.ownerId);
    if (mapping.organizationId !== args.organizationId) throw new Error("BUYER_CONTEXT_MISMATCH");
    return await ctx.db.insert("invoices", { ownerId: args.ownerId, organizationId: args.organizationId, amount: 42, shared: false });
  } }),
};
