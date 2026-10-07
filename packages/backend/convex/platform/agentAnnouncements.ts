/** Thin grant-aware entry points; business logic stays in native announcement handlers. */
import { v } from "convex/values";
import { query, mutation, type MutationCtx } from "../_generated/server";
import { requireGrant } from "./agentAccess";
import { rateLimit } from "./rateLimits";
import { announcementListArgs, announcementCreateArgs, announcementUpdateArgs, announcementRemoveArgs,
  listAnnouncement, createAnnouncement, updateAnnouncement, removeAnnouncement } from "./announcements";
const credentialArgs = { token: v.string(), resource: v.string() };
async function writer(ctx: MutationCtx, token: string, resource: string) {
  const auth = await requireGrant(ctx, token, resource, true);
  await rateLimit(ctx, { name: "mutationGlobal", key: auth.ownerId, throws: true });
  return { ...ctx, ...auth };
}
export const list = query({
  args: { ...credentialArgs, ...announcementListArgs },
  handler: async (ctx, { token, resource, ...args }) =>
    listAnnouncement({ ...ctx, ...await requireGrant(ctx, token, resource) }, args),
});
export const get = query({
  args: { ...credentialArgs, announcementId: v.string() },
  handler: async (ctx, { token, resource, announcementId }) => {
    const rows = await listAnnouncement({ ...ctx, ...await requireGrant(ctx, token, resource) }, { includeArchived: true });
    return rows?.find(row => row._id === announcementId) ?? null;
  },
});
export const create = mutation({
  args: { ...credentialArgs, ...announcementCreateArgs },
  handler: async (ctx, { token, resource, ...args }) => createAnnouncement(await writer(ctx, token, resource), args),
});
export const update = mutation({
  args: { ...credentialArgs, ...announcementUpdateArgs },
  handler: async (ctx, { token, resource, ...args }) => updateAnnouncement(await writer(ctx, token, resource), args),
});
export const remove = mutation({
  args: { ...credentialArgs, ...announcementRemoveArgs },
  handler: async (ctx, { token, resource, ...args }) => removeAnnouncement(await writer(ctx, token, resource), args),
});
