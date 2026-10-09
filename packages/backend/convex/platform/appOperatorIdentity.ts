/** Principal-only checks: no session, delegation or native-dispatch dependencies. */
import { components } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";

type Reader = Pick<QueryCtx, "runQuery">;

/** Mixed records are quarantined without deleting identities or legacy ownership references. */
export async function isAppOperatorIdentity(ctx: Reader, user: Doc<"user">): Promise<boolean> {
  if (user.role !== "admin" || user.customerAdmission) return false;
  const membership = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "member", where: [{ field: "userId", value: user._id }],
  });
  if (membership) return false;
  const organization = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "organization", where: [{ field: "personalOwnerId", value: user._id }],
  });
  return !organization;
}

export async function appOperatorIdentity(ctx: Reader, userId: string): Promise<Doc<"user"> | null> {
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user", where: [{ field: "_id", value: userId }],
  }) as Doc<"user"> | null;
  return user && await isAppOperatorIdentity(ctx, user) ? user : null;
}

export async function requireAppOperatorTarget(ctx: Reader, userId: string): Promise<Doc<"user">> {
  const user = await appOperatorIdentity(ctx, userId);
  if (!user) throw new Error("OPERATOR_TARGET_REQUIRED");
  return user;
}
