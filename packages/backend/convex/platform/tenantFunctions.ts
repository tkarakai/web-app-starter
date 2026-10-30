import { assertOrganizationWriteAllowed } from "./organizationReadiness";
import { v, type ObjectType, type PropertyValidators } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { rateLimit } from "./rateLimits";
import { getTenantContext, requireTenantContext, type TenantAuth } from "./tenantContext";

/** Strict tenant builders are deliberately not operator/native agent capabilities. */
export function tenantQuery<Args extends PropertyValidators, Output>(definition: {
  args: Args;
  handler: (ctx: QueryCtx & TenantAuth, args: ObjectType<Args> & { organizationId: string }) => Output | Promise<Output>;
}) {
  return query({ args: { ...definition.args, organizationId: v.string() },
    handler: async (ctx, args) => {
      // Reactive reads must survive loss of assurance, just like authedQuery.
      const auth = await getTenantContext(ctx, args.organizationId);
      return auth ? definition.handler({ ...ctx, ...auth }, args) : null;
    },
  });
}
export function tenantMutation<Args extends PropertyValidators, Output>(definition: {
  args: Args;
  handler: (ctx: MutationCtx & TenantAuth, args: ObjectType<Args> & { organizationId: string }) => Output | Promise<Output>;
}) {
  return mutation({ args: { ...definition.args, organizationId: v.string() },
    handler: async (ctx, args) => {
      await assertOrganizationWriteAllowed(ctx, "tenant");
      const auth = await requireTenantContext(ctx, args.organizationId);
      await rateLimit(ctx, { name: "mutationGlobal", key: auth.ownerId, throws: true });
      return definition.handler({ ...ctx, ...auth }, args);
    },
  });
}
