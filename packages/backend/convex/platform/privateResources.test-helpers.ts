/** Test-only private rows and real tenant guards; no sample domain or deployed endpoints. */
import { defineSchema, defineTable, makeFunctionReference, type DataModelFromSchemaDefinition, type GenericMutationCtx, type GenericQueryCtx } from "convex/server";
import { v, type GenericId } from "convex/values";
import { convexTest } from "convex-test";
import { registerPlatform } from "@web-app-starter/convex-platform/test";
import schema from "../schema";
import { tenantMutation, tenantQuery } from "./tenantFunctions";

const fixtureSchema = defineSchema({ ...schema.tables, securityTestPrivateResources: defineTable({
  ownerId: v.string(), organizationId: v.optional(v.string()), name: v.string(), description: v.string(), createdAt: v.number(),
}) });
type FixtureModel = DataModelFromSchemaDefinition<typeof fixtureSchema>;
type ResourceId = GenericId<"securityTestPrivateResources">;
const fixturePath = "platform/securityTestPrivateResources";
export const privateResourceApi = {
  create: makeFunctionReference<"mutation", { organizationId: string; name: string; description: string }, ResourceId>(`${fixturePath}:create`),
  get: makeFunctionReference<"query", { organizationId: string; id: ResourceId }, FixtureModel["securityTestPrivateResources"]["document"] | null>(`${fixturePath}:get`),
};

export function createPrivateResourceTestEnv(modules: Record<string, () => Promise<unknown>>) {
  const t = convexTest(fixtureSchema, { ...modules, [`./${fixturePath}.ts`]: async () => ({
    create: tenantMutation({ args: { name: v.string(), description: v.string() }, handler: async (ctx, args) => {
      // Only the test schema is extended. Authority still comes from the production wrapper.
      const db = (ctx as unknown as GenericMutationCtx<FixtureModel>).db;
      return await db.insert("securityTestPrivateResources", {
        ownerId: ctx.ownerId, organizationId: ctx.organizationId, name: args.name, description: args.description, createdAt: Date.now(),
      });
    } }),
    get: tenantQuery({ args: { id: v.id("securityTestPrivateResources") }, handler: async (ctx, { id }) => {
      const db = (ctx as unknown as GenericQueryCtx<FixtureModel>).db;
      const row = await db.get(id);
      return row?.ownerId === ctx.ownerId && row.organizationId === ctx.organizationId ? row : null;
    } }),
  }) });
  registerPlatform(t);
  return t;
}
