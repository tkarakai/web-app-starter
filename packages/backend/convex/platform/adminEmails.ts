/** @deprecated API namespace retained for compatibility; these are app-operator operations. */
import { rememberNative } from "./nativeCapabilities";
import type { QueryCtx } from "../_generated/server";
import type { ObjectType } from "convex/values";
import { components } from "../_generated/api";
import { internalQuery, query } from "../_generated/server";
import { getAuth } from "./functions";
import { isAppOperatorIdentity, requireAppOperator } from "./appOperatorAccess";
import { filterAppOperatorEmails } from "./appOperatorDirectory";

async function appOperatorEmails(ctx: QueryCtx): Promise<string[]> {
  const rows = await ctx.runQuery(components.platform.adminEmails.list, {});
  return filterAppOperatorEmails(ctx, rows.map(row => row.email));
}

export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(components.platform.adminEmails.list, {});
  },
});

/**
 * Returns the list of protected admin emails.
 * Restricted to admin users only to prevent information disclosure.
 */
const listProtectedNativeArgs = {};
export const listProtected = rememberNative(query({
  args: listProtectedNativeArgs,
  handler: async (ctx) => {
    let user;
    try {
      user = (await getAuth(ctx))?.user;
    } catch {
      return [];
    }
    if (!user) {
      return [];
    }

    // Only admin users may see the admin email list.
    // Without this check any authenticated user could enumerate admin emails,
    // which could be combined with other attacks (e.g. phishing, account takeover).
    if (!await isAppOperatorIdentity(ctx, user)) {
      return [];
    }

    return await appOperatorEmails(ctx);
  },
}), { args: listProtectedNativeArgs, handler: async (ctx: QueryCtx, _args: ObjectType<typeof listProtectedNativeArgs>) => { await requireAppOperator(ctx); return await appOperatorEmails(ctx); } }, "query");
