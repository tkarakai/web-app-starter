/** Public and internal app API: authorization stays here; the component owns storage and scheduling. */
import { v, type ObjectType } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { authorizedSession } from "./sessionPolicy";
type AnnouncementIdentity = Pick<NonNullable<Awaited<ReturnType<typeof authorizedSession>>>, "user" | "ownerId">;
import { components } from "../_generated/api";
import { internalMutation, internalQuery, query } from "../_generated/server";
import { adminMutation, authedQuery } from "./functions";

// Shared native handlers used by the UI and authenticated capability adapters.
export const announcementListArgs = {
    includeArchived: v.optional(v.boolean()),
    sortBy: v.optional(
      v.union(
        v.literal("scheduleStart"),
        v.literal("scheduleEnd"),
        v.literal("status"),
        v.literal("name")
      )
    ),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  };

export async function listAnnouncement(ctx: QueryCtx & AnnouncementIdentity, args: ObjectType<typeof announcementListArgs>) {
    if ((ctx.user as Record<string, unknown>).role !== "admin") return null;
    return await ctx.runQuery(components.platform.announcements.list, args);
  }

export const announcementCreateArgs = {
    name: v.string(),
    bannerText: v.string(),
    callToActionName: v.optional(v.string()),
    callToActionUrl: v.optional(v.string()),
    learnMoreName: v.optional(v.string()),
    learnMoreContent: v.optional(v.string()),
    scheduleStart: v.optional(v.number()),
    scheduleEnd: v.optional(v.number()),
  };

export async function createAnnouncement(ctx: MutationCtx & AnnouncementIdentity, args: ObjectType<typeof announcementCreateArgs>) {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.announcements.create, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
  }

export const announcementUpdateArgs = {
    announcementId: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      bannerText: v.optional(v.string()),
      callToActionName: v.optional(v.string()),
      callToActionUrl: v.optional(v.string()),
      learnMoreName: v.optional(v.string()),
      learnMoreContent: v.optional(v.string()),
      scheduleStart: v.optional(v.union(v.number(), v.null())),
      scheduleEnd: v.optional(v.union(v.number(), v.null())),
    }),
  };

export async function updateAnnouncement(ctx: MutationCtx & AnnouncementIdentity, args: ObjectType<typeof announcementUpdateArgs>) {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.announcements.update, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
  }

export const announcementRemoveArgs = { announcementId: v.string() };

export async function removeAnnouncement(ctx: MutationCtx & AnnouncementIdentity, args: ObjectType<typeof announcementRemoveArgs>) {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.announcements.remove, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
  }


function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getLandingPageUrl(): string {
  return requireEnv("LANDING_URL");
}

function getWebAppUrl(): string {
  const raw = requireEnv("SITE_URL");
  const first = raw
    .split(",")
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!first) throw new Error("SITE_URL environment variable is empty");
  return first;
}

function renderLearnMoreContent(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replaceAll("{{landingPageUrl}}", getLandingPageUrl())
    .replaceAll("{{webAppUrl}}", getWebAppUrl());
}


export const getActivePublic = query({
  args: {},
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(components.platform.announcements.getActivePublic, args);
    return result ? { ...result, learnMoreContent: renderLearnMoreContent(result.learnMoreContent) } : null;
  },
});

export const getActiveInternal = internalQuery({
  args: {},
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(components.platform.announcements.getActiveInternal, args);
    return result ? { ...result, learnMoreContent: renderLearnMoreContent(result.learnMoreContent) } : null;
  },
});

export const handleScheduledStart = internalMutation({
  args: {
    announcementId: v.string(),
    expectedScheduleStart: v.number(),
    expectedScheduleEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.platform.announcements.handleScheduledStart, args);
  },
});

export const handleScheduledEnd = internalMutation({
  args: {
    announcementId: v.string(),
    expectedScheduleEnd: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.platform.announcements.handleScheduledEnd, args);
  },
});

export const list = authedQuery({
  args: announcementListArgs,
  handler: listAnnouncement,
});

export const getAdminListInternal = internalQuery({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.platform.announcements.getAdminListInternal, args);
  },
});

export const create = adminMutation({
  args: announcementCreateArgs,
  handler: createAnnouncement,
});

export const update = adminMutation({
  args: announcementUpdateArgs,
  handler: updateAnnouncement,
});

export const publishNow = adminMutation({
  args: {
    announcementId: v.string(),
  },
  handler: async (ctx, args) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.announcements.publishNow, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
  },
});

export const publishNowInternal = internalMutation({
  args: {
    announcementId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.platform.announcements.publishNowInternal, args);
  },
});

export const unpublishNow = adminMutation({
  args: {
    announcementId: v.string(),
  },
  handler: async (ctx, args) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.announcements.unpublishNow, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
  },
});

export const unpublishNowInternal = internalMutation({
  args: {
    announcementId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.platform.announcements.unpublishNowInternal, args);
  },
});

export const setLive = adminMutation({
  args: {
    announcementId: v.string(),
    isLive: v.boolean(),
    confirmDisableOthers: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.announcements.setLive, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
  },
});

export const archive = adminMutation({
  args: {
    announcementId: v.string(),
  },
  handler: async (ctx, args) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.announcements.archive, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
  },
});

export const remove = adminMutation({
  args: announcementRemoveArgs,
  handler: removeAnnouncement,
});
