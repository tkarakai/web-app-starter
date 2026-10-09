import { v } from "convex/values";
import { components } from "../_generated/api";
import { query, type QueryCtx } from "../_generated/server";
import { getAuth } from "./functions";

export async function requireCustomerSession(ctx: QueryCtx) {
  const auth = await getAuth(ctx);
  if (!auth) throw new Error("NOT_AUTHENTICATED");
  if (auth.assurance.scope !== "user" || (auth.user.role ?? "user") !== "user") throw new Error("NOT_CUSTOMER");
  return auth;
}

/** Resolve only the caller-supplied immutable ID; session activeOrganizationId is never authority. */
export async function requireTenantContext(ctx: QueryCtx, organizationId: string) {
  if (!organizationId) throw new Error("EXPLICIT_ORGANIZATION_CONTEXT_REQUIRED");
  const auth = await requireCustomerSession(ctx);
  const organization = await ctx.runQuery(components.betterAuth.organizations.context, { organizationId, userId: auth.user._id });
  return { ...auth, organizationId: organization.organizationId, organization };
}
export type TenantAuth = Awaited<ReturnType<typeof requireTenantContext>>;

/** Transitional legacy-private entry points preserve old personal access, not multi-tenant authority. */
export async function requireLegacyPrivateAccess(ctx: QueryCtx, organizationId?: string) {
  const auth = await requireCustomerSession(ctx);
  const personalId = await ctx.runQuery(components.betterAuth.organizations.legacyPrivateAccess, { userId: auth.user._id });
  if (organizationId !== undefined && (!organizationId || organizationId !== personalId)) throw new Error("ORGANIZATION_UNAVAILABLE");
  return auth;
}

export const mine = query({
  args: {},
  handler: async ctx => {
    const auth = await requireCustomerSession(ctx);
    const contexts: Array<{ organizationId: string; name: string; experience: "personal" | "collaborative";
      lifecycle: "active" | "disabled" | "provisioning"; role: "org-admin" | "member"; personal: boolean }> =
      await ctx.runQuery(components.betterAuth.organizations.mine, { userId: auth.user._id });
    let legacyPrivateAvailable = false;
    try {
      await ctx.runQuery(components.betterAuth.organizations.legacyPrivateAccess, { userId: auth.user._id });
      legacyPrivateAvailable = true;
    } catch {
      // A private bridge is never a fallback from unavailable/ambiguous tenant authority.
    }
    return { userId: auth.user._id, contexts, legacyPrivateAvailable, personalOrganizationId: contexts.find(context => context.personal)?.organizationId ?? null,
      // A zero-membership legacy identity is not silently provisioned or assigned a guessed tenant.
      mappingRequired: contexts.length === 0 };
  },
});
export const get = query({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => (await requireTenantContext(ctx, organizationId)).organization,
});
