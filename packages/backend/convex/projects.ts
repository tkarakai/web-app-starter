import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  orgMutation,
  orgPaginatedQuery,
  orgQuery,
  assertMaxLength,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from "./platform/functions";
import { hasExclusiveFileOwnership } from "./fileAccess";
import { requireProjectAccess } from "./projectAccess";

/** Largest page a list returns: every list here is paginated, never `.collect()`ed. */
const MAX_PAGE = 100;
/** Counts stop here: a summary reads at most this many rows per count (`counted`). */
export const MAX_COUNTED = 99;
/** Rows deleted per batch of a project deletion, and batches run in the deleting call. */
const DELETE_BATCH = 100;
const INLINE_DELETE_BATCHES = 5;

export function assertPageSize(paginationOpts: { numItems: number }, max = MAX_PAGE) {
  if (paginationOpts.numItems > max) throw new Error("INVALID_PAGE_SIZE");
}

/** A count that stops at `MAX_COUNTED`: `capped` says there are more. */
export async function counted(rows: Promise<unknown[]>): Promise<{ count: number; capped: boolean }> {
  const found = (await rows).length;
  return { count: Math.min(found, MAX_COUNTED), capped: found > MAX_COUNTED };
}

/** A project's task and upload counts, each read up to `MAX_COUNTED` rows. */
export async function projectStats(ctx: Pick<QueryCtx, "db">, projectId: Id<"projects">) {
  const [tasks, done, uploads] = await Promise.all([
    counted(ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", projectId)).take(MAX_COUNTED + 1)),
    counted(ctx.db.query("tasks").withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "done")).take(MAX_COUNTED + 1)),
    counted(ctx.db.query("uploads").withIndex("by_project", (q) => q.eq("projectId", projectId)).take(MAX_COUNTED + 1)),
  ]);
  return {
    taskCount: tasks.count,
    doneCount: done.count,
    uploadCount: uploads.count,
    /** Some count stopped at `MAX_COUNTED`: show it as "99+" and no percentage. */
    countsCapped: tasks.capped || done.capped || uploads.capped,
  };
}

/** The organization's projects, newest first, a page at a time (`usePaginatedQuery`). */
export const list = orgPaginatedQuery({
  args: {},
  handler: async (ctx, args) => {
    assertPageSize(args.paginationOpts);
    return await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/** `list` with each project's counts (`projectStats`), a smaller page at a time. */
export const listWithStats = orgPaginatedQuery({
  args: {},
  handler: async (ctx, args) => {
    assertPageSize(args.paginationOpts, 24);
    const result = await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(result.page.map(async (project) => ({ ...project, ...(await projectStats(ctx, project._id)) }))),
    };
  },
});

/**
 * `null` when the project is gone or belongs to another organization (a teammate may delete
 * it), or `id` isn't a project ID at all (a URL the user edited).
 */
export const get = orgQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("projects", args.id);
    const project = id ? await ctx.db.get(id) : null;
    return project?.organizationId && project.organizationId === ctx.organizationId ? project : null;
  },
});

export const create = orgMutation({
  args: {
    name: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME");
    assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "DESCRIPTION");

    return ctx.db.insert("projects", {
      name: args.name,
      description: args.description,
      ownerId: ctx.ownerId,
      organizationId: ctx.organizationId,
      createdAt: Date.now(),
    });
  },
});

export const update = orgMutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.id);
    assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME");
    assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "DESCRIPTION");

    const updates: Partial<{ name: string; description: string }> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;

    return ctx.db.patch(args.id, updates);
  },
});

/**
 * Delete one batch of a project's uploads, then tasks; `true` once none are left. `strict`
 * refuses an upload whose object has no trustworthy provenance (`FILE_QUARANTINED`); otherwise
 * its row goes and its object is kept, as `organizationData.ts` does.
 */
async function deleteProjectBatch(ctx: Pick<MutationCtx, "db" | "storage">, projectId: Id<"projects">, strict: boolean): Promise<boolean> {
  const uploads = await ctx.db.query("uploads").withIndex("by_project", (q) => q.eq("projectId", projectId)).take(DELETE_BATCH);
  for (const upload of uploads) {
    const exclusive = await hasExclusiveFileOwnership(ctx, upload);
    if (!exclusive && strict) throw new Error("FILE_QUARANTINED");
    await ctx.db.delete(upload._id);
    if (exclusive) await ctx.storage.delete(upload.storageId);
  }
  if (uploads.length === DELETE_BATCH) return false;
  const room = DELETE_BATCH - uploads.length;
  const tasks = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", projectId)).take(room);
  for (const task of tasks) await ctx.db.delete(task._id);
  return tasks.length < room;
}

/**
 * Delete a project with its tasks and uploads. Up to 500 rows go in this call, refused as a
 * whole if one of those uploads is quarantined. A larger project goes now and the rest of its
 * rows, unreachable without it (`requireProjectAccess`), in background batches
 * (`deleteRemainingRows`): a mutation must stay within Convex's per-transaction limits however
 * many tasks a project has.
 */
export const remove = orgMutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.id);
    let done = false;
    for (let i = 0; i < INLINE_DELETE_BATCHES && !done; i++) done = await deleteProjectBatch(ctx, args.id, true);
    await ctx.db.delete(args.id);
    if (!done) await ctx.scheduler.runAfter(0, internal.projects.deleteRemainingRows, { projectId: args.id });
  },
});

/** The rest of a deleted project's rows, a batch per run (`remove`). Never while the project exists. */
export const deleteRemainingRows = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.projectId)) return;
    if (!(await deleteProjectBatch(ctx, args.projectId, false))) {
      await ctx.scheduler.runAfter(0, internal.projects.deleteRemainingRows, args);
    }
  },
});
