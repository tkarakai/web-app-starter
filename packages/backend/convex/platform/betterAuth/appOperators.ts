/** Component-local operator projections. Component callers still authenticate their acting principal. */
import { convexToJson, jsonToConvex, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const EMAIL_BATCH_SIZE = 100;
const DIRECTORY_SCAN_LIMIT = 200;

async function canonicalOperator(ctx: QueryCtx, user: Doc<"user">): Promise<boolean> {
  if (user.role !== "admin" || user.customerAdmission) return false;
  if (await ctx.db.query("member").withIndex("userId", q => q.eq("userId", user._id)).first()) return false;
  return !await ctx.db.query("organization").withIndex("personalOwnerId", q => q.eq("personalOwnerId", user._id)).first();
}

/** Index-aligned results preserve caller order, duplicates and lookup-case semantics. No pending identity is authority. */
export const filterEmails = query({
  args: { emails: v.array(v.string()) }, returns: v.array(v.union(v.string(), v.null())),
  handler: async (ctx, { emails }) => {
    if (emails.length > EMAIL_BATCH_SIZE) throw new Error("OPERATOR_EMAIL_BATCH_TOO_LARGE");
    const result: (string | null)[] = [];
    for (const email of emails) {
      const user = await ctx.db.query("user").withIndex("email_name", q => q.eq("email", email)).unique();
      result.push(user && await canonicalOperator(ctx, user) ? user.email : null);
    }
    return result;
  },
});

async function decodeCursor(ctx: QueryCtx, value: string | null | undefined, binding: string,
  visible: (user: Doc<"user">) => Promise<boolean>): Promise<string | null | undefined> {
  if (value === null || value === undefined) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const cursor = parsed as Record<string, unknown>;
    if (cursor.version !== 1 || cursor.binding !== binding || typeof cursor.cursor !== "string"
      || Object.keys(cursor).length !== 3) throw new Error();
    const key = jsonToConvex(JSON.parse(cursor.cursor));
    if (!Array.isArray(key) || key.length !== 4 || typeof key[3] !== "string") throw new Error();
    // Match stream's escaping for strings ending in its undefined sentinel.
    const rawId = key[3].endsWith("undefined") ? key[3].slice(1) : key[3];
    const id = ctx.db.normalizeId("user", rawId);
    const anchor = id ? await ctx.db.get(id) : null;
    if (!anchor || !await visible(anchor)) throw new Error();
    const expected = JSON.stringify(convexToJson([anchor.role, anchor.createdAt, anchor._creationTime, anchor._id]
      .map(field => typeof field === "string" && field.endsWith("undefined") ? `_${field}` : field ?? "undefined")));
    if (cursor.cursor !== expected) throw new Error();
    return cursor.cursor;
  } catch { throw new Error("OPERATOR_DIRECTORY_CURSOR_INVALID"); }
}

export const listDirectory = query({
  args: {
    operatorId: v.string(), paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()), searchField: v.optional(v.union(v.literal("email"), v.literal("name"))),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    status: v.optional(v.union(v.literal("active"), v.literal("banned"))), emailVerified: v.optional(v.boolean()),
  },
  returns: v.object({
    page: v.array(v.object({
      id: v.string(), name: v.string(), email: v.string(), role: v.string(), emailVerified: v.boolean(),
      banned: v.boolean(), banReason: v.optional(v.union(v.string(), v.null())),
      banExpires: v.optional(v.union(v.number(), v.null())), twoFactorEnabled: v.boolean(),
      createdAt: v.number(), updatedAt: v.number(), image: v.optional(v.union(v.string(), v.null())),
    })),
    isDone: v.boolean(), continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const operatorId = ctx.db.normalizeId("user", args.operatorId);
    const actor = operatorId ? await ctx.db.get(operatorId) : null;
    if (!actor || actor.banned || !await canonicalOperator(ctx, actor)) throw new Error("NOT_ADMIN");
    if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100) throw new Error("INVALID_PAGE_SIZE");
    const direction = args.sortDirection ?? "desc";
    const searchField = args.searchField ?? "email";
    const search = searchField === "email" ? args.search?.toLowerCase() ?? "" : args.search ?? "";
    const binding = JSON.stringify(["app-operators", args.operatorId, direction, searchField, search, args.status ?? null, args.emailVerified ?? null]);
    const visible = async (user: Doc<"user">) => {
      if (search && !user[searchField].includes(search)) return false;
      if (args.status === "banned" && user.banned !== true || args.status === "active" && user.banned === true) return false;
      if (args.emailVerified !== undefined && user.emailVerified !== args.emailVerified) return false;
      return canonicalOperator(ctx, user);
    };
    const cursor = await decodeCursor(ctx, args.paginationOpts.cursor, binding, visible) ?? null;
    const endCursor = await decodeCursor(ctx, args.paginationOpts.endCursor, binding, visible);
    const result = await stream(ctx.db, schema).query("user")
      .withIndex("role_createdAt", q => q.eq("role", "admin")).order(direction)
      .filterWith(visible).paginate({ ...args.paginationOpts, cursor, endCursor, maximumRowsRead: DIRECTORY_SCAN_LIMIT });
    // A scan-limit cursor can identify a hidden mixed record. Fail closed rather than disclose it.
    if (result.pageStatus === "SplitRequired") throw new Error("OPERATOR_DIRECTORY_SCAN_LIMIT");
    return {
      page: result.page.map(user => ({ id: user._id, name: user.name, email: user.email, role: user.role ?? "user",
        emailVerified: user.emailVerified, banned: user.banned ?? false, banReason: user.banReason,
        banExpires: user.banExpires, twoFactorEnabled: user.twoFactorEnabled ?? false,
        createdAt: user.createdAt, updatedAt: user.updatedAt, image: user.image })),
      isDone: result.isDone,
      continueCursor: result.isDone ? "" : JSON.stringify({ version: 1, binding, cursor: result.continueCursor }),
    };
  },
});
