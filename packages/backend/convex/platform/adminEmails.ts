/** @deprecated API namespace retained for compatibility; these are app-operator operations. */
import { rememberNative } from "./nativeCapabilities";
import type { QueryCtx } from "../_generated/server";
import type { ObjectType } from "convex/values";
import { components } from "../_generated/api";
import { internalQuery, query } from "../_generated/server";
import { getAuth } from "./functions";
import { isAppOperatorIdentity, requireAppOperator } from "./appOperatorAccess";

async function appOperatorEmails(ctx: QueryCtx): Promise<string[]> {
  const rows = await ctx.runQuery(components.platform.adminEmails.list, {});
  const emails: string[] = [];
  for (const row of rows) {
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: row.email }] });
    if (user && await isAppOperatorIdentity(ctx, user)) emails.push(user.email);
  }
  return emails;
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
